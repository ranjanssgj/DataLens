import os
import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any, Dict, List
from dotenv import load_dotenv

load_dotenv()

from connectors import get_connector
from services.quality import run_quality_analysis
from services.ai_service import (
    ensure_qdrant_collection,
    generate_docs_background,
    rag_chat,
    job_status,
    init_ai,
)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/datalens")

app = FastAPI(title="DataLens AI Python Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.on_event("startup")
async def startup_event():
    try:
        qdrant = init_ai()
        ensure_qdrant_collection(qdrant)
        print("[STARTUP] Qdrant collection verified")
    except Exception as e:
        print(f"[STARTUP] Warning — could not initialize Qdrant: {e}")



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



@app.get("/health")
def health():
    return {"status": "ok"}


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
    job_status[snapshot_id] = {"status": "queued", "progress": 0, "total": 0, "currentTable": ""}
    background_tasks.add_task(generate_docs_background, snapshot_id, MONGO_URI)
    return {
        "message": "Documentation generation started",
        "pollUrl": f"/job-status/{snapshot_id}",
    }


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
