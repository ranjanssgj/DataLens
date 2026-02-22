from dotenv import load_dotenv
load_dotenv()  # Load .env before ANYTHING else runs

import os
import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any, Dict, List

from connectors import get_connector
from services.quality import run_quality_analysis
from services.ai_service import (
    ensure_qdrant_collection,
    generate_docs_background,
    generate_table_overview,
    rag_chat,
    job_status,
    init_ai,
    re_embed_snapshot,
)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/datalens")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: validate required env vars and initialize Qdrant."""
    required_vars = ["GEMINI_API_KEY", "MONGO_URI", "QDRANT_URL"]
    missing = [v for v in required_vars if not os.getenv(v)]

    if missing:
        print(f"[STARTUP] Missing environment variables: {', '.join(missing)}")
        print(f"[STARTUP]    Check python-service/.env")
    else:
        key = os.getenv("GEMINI_API_KEY", "")
        print(f"[STARTUP] GEMINI_API_KEY loaded: {key[:8]}...")
        print(f"[STARTUP] MONGO_URI: {os.getenv('MONGO_URI', '')[:40]}...")
        print(f"[STARTUP] QDRANT_URL: {os.getenv('QDRANT_URL')}")

    provider = os.getenv("AI_PROVIDER", "groq")
    print(f"[STARTUP] AI_PROVIDER: {provider.upper()}")
    if provider == "groq":
        groq_key = os.getenv("GROQ_API_KEY", "")
        print(f"[STARTUP] GROQ_API_KEY loaded: {groq_key[:8]}..." if groq_key else "[STARTUP]  GROQ_API_KEY not set")

    try:
        _, qdrant = init_ai()
        ensure_qdrant_collection(qdrant)
        print("[STARTUP] Qdrant collection verified")
    except Exception as e:
        print(f"[STARTUP]   Qdrant init failed: {e}")

    yield  # App runs here


app = FastAPI(title="DataLens Python Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Credentials(BaseModel):
    db_type: str
    host: Optional[str] = None
    port: Optional[Any] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    # Snowflake
    account: Optional[str] = None
    warehouse: Optional[str] = None
    schema: Optional[str] = None


class ChatRequest(BaseModel):
    question: str
    snapshotId: str
    history: Optional[List[Dict]] = []


class TableOverviewRequest(BaseModel):
    table: dict
    snapshotId: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "DataLens Python Service"}


@app.get("/test-ai")
async def test_ai():
    """Test whichever AI provider is configured."""
    provider = os.getenv("AI_PROVIDER", "groq")
    try:
        from services.ai_service import _generate_text
        result = _generate_text("Say 'DataLens AI connection successful' and nothing else.")
        return {
            "status": "ok",
            "provider": provider,
            "response": result.strip(),
        }
    except Exception as e:
        return {
            "status": "error",
            "provider": provider,
            "error": str(e),
        }


@app.get("/test-embed")
async def test_embed():
    try:
        from services.ai_service import _get_embedding
        vector = _get_embedding("test embedding for DataLens", "RETRIEVAL_DOCUMENT")
        return {
            "status": "ok",
            "vector_length": len(vector),
            "sample": vector[:5]
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/extract")
async def extract(creds: Credentials):
    """Extract schema from the target database."""
    try:
        connector = get_connector(creds.db_type)
        tables = await connector.extract(creds.dict())
        return {"tables": tables, "tableCount": len(tables)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


@app.post("/quality/{snapshot_id}")
def quality(snapshot_id: str, creds: Credentials):
    """Run quality analysis and write results to MongoDB."""
    try:
        count = run_quality_analysis(snapshot_id, creds.dict())
        return {"count": count, "snapshotId": snapshot_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quality analysis failed: {str(e)}")


@app.post("/generate-docs/{snapshot_id}")
async def generate_docs(snapshot_id: str, background_tasks: BackgroundTasks):
    """Start AI documentation generation as a background task."""
    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        raise HTTPException(status_code=500, detail="MONGO_URI not set in environment")

    # Reset job status immediately so frontend can start polling
    job_status[snapshot_id] = {
        "status": "running",
        "progress": 0,
        "total": 0,
        "currentTable": "Starting AI documentation...",
    }

    background_tasks.add_task(
        generate_docs_background,
        snapshot_id=snapshot_id,
        mongo_uri=mongo_uri,
    )

    return {
        "message": "AI documentation generation started",
        "snapshotId": snapshot_id,
        "pollUrl": f"/job-status/{snapshot_id}",
    }


@app.post("/re-embed/{snapshot_id}")
async def re_embed(snapshot_id: str):
    """Re-embed an existing snapshot without calling the LLM for generation."""
    try:
        mongo_uri = os.getenv("MONGO_URI")
        if not mongo_uri:
             raise HTTPException(status_code=500, detail="MONGO_URI not set in environment")
        
        result = re_embed_snapshot(snapshot_id, mongo_uri)
        if result.get("status") == "error":
             raise HTTPException(status_code=500, detail=result.get("message"))
        return result
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Re-embed failed: {str(e)}")


@app.get("/job-status/{snapshot_id}")
def get_job_status(snapshot_id: str):
    """Get documentation generation progress for a snapshot."""
    status = job_status.get(
        snapshot_id,
        {"status": "not_started", "progress": 0, "total": 0, "currentTable": ""}
    )
    return status


@app.post("/chat")
def chat(req: ChatRequest):
    """RAG-powered chat endpoint."""
    try:
        result = rag_chat(req.question, req.snapshotId, req.history or [], MONGO_URI)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/table-overview")
async def table_overview(req: TableOverviewRequest):
    """Generate detailed AI overview for a single table on demand."""
    try:
        result = generate_table_overview(req.table)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
