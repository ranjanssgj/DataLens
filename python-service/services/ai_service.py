import os
import json
import time
import datetime
import pymongo
from google import genai
from google.genai import types as genai_types
from groq import Groq
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)
from bson import ObjectId


_MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/datalens")
_mongo_client = pymongo.MongoClient(_MONGO_URI)

QDRANT_COLLECTION = "table_docs"
VECTOR_SIZE = 768  # text-embedding-004 native output size

job_status = {}
_gemini_client = None       # for text generation — uses v1
_gemini_embed_client = None # for embeddings — uses v1beta (default)
_groq_client = None

def init_groq():
    """Initialize Groq client."""
    global _groq_client
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in .env")
    if _groq_client is None:
        _groq_client = Groq(api_key=api_key)
    return _groq_client


def init_ai():
    """Initialize Gemini clients (generation + embedding) and Qdrant."""
    global _gemini_client, _gemini_embed_client

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set. Check python-service/.env")

    print(f"[AI] Using Gemini API key: {api_key[:8]}...")

    # Generation client — must use v1 for gemini-1.5-flash
    if _gemini_client is None:
        _gemini_client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1"}
        )

    # Embedding client — must use default v1beta for gemini-embedding-001
    if _gemini_embed_client is None:
        _gemini_embed_client = genai.Client(api_key=api_key)
        # No http_options — defaults to v1beta where gemini-embedding-001 lives

    qdrant = QdrantClient(
        url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        api_key=os.getenv("QDRANT_API_KEY") or None,
    )

    return _gemini_client, qdrant


def ensure_qdrant_collection(qdrant: QdrantClient):
    """Create or recreate the Qdrant collection with the correct vector size."""
    collections = qdrant.get_collections().collections
    existing = {c.name: c for c in collections}
    if QDRANT_COLLECTION in existing:
        col_info = qdrant.get_collection(QDRANT_COLLECTION)
        if col_info.config.params.vectors.size != VECTOR_SIZE:
            print(f"[QDRANT] Vector size mismatch ({col_info.config.params.vectors.size} vs {VECTOR_SIZE}), recreating...")
            qdrant.delete_collection(QDRANT_COLLECTION)
        else:
            return
    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"[QDRANT] Created collection with {VECTOR_SIZE}-dim cosine vectors")


def _get_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    """
    Get embedding vector using gemini-embedding-001.
    Uses the v1beta client (default) — this model is NOT on v1.
    Output is truncated to 768 dimensions for Qdrant compatibility.
    """
    global _gemini_embed_client

    api_key = os.getenv("GEMINI_API_KEY")
    if _gemini_embed_client is None:
        _gemini_embed_client = genai.Client(api_key=api_key)

    response = _gemini_embed_client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=genai_types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=768,  # truncate to 768 to match Qdrant collection
        ),
    )
    return response.embeddings[0].values

def _get_embedding_with_retry(text: str, task_type: str = "RETRIEVAL_DOCUMENT", max_retries: int = 3) -> list:
    """Get embedding with retry on transient errors."""
    import time
    for attempt in range(max_retries):
        try:
            return _get_embedding(text, task_type)
        except Exception as e:
            error_str = str(e).lower()
            if attempt < max_retries - 1 and ("429" in error_str or "quota" in error_str or "rate" in error_str):
                wait = (2 ** attempt) * 5
                print(f"[EMBED] Rate limit, waiting {wait}s (attempt {attempt+1})...")
                time.sleep(wait)
            else:
                raise


def _generate_text(prompt: str) -> str:
    """
    Generate text using the configured AI provider.
    Set AI_PROVIDER=groq or AI_PROVIDER=gemini in .env
    Groq uses gpt-oss-120b (no rate limits on free tier).
    Gemini uses gemini-1.5-flash.
    """
    provider = os.getenv("AI_PROVIDER", "groq").lower()

    if provider == "groq":
        client = init_groq()
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, # match temperature with typical gemini behaviour
            max_tokens=8192,
        )
        return response.choices[0].message.content

    else:  # gemini fallback
        gemini, _ = init_ai()
        return _call_gemini_with_retry(gemini, prompt)

def _call_gemini_with_retry(gemini_client: genai.Client, prompt: str, max_retries: int = 3) -> str:
    """Call Gemini gemini-1.5-flash with retry on rate limit errors."""
    for attempt in range(max_retries):
        try:
            response = gemini_client.models.generate_content(
                model="gemini-1.5-flash",
                contents=prompt,
            )
            return response.text
        except Exception as e:
            error_str = str(e).lower()
            is_rate_limit = any(kw in error_str for kw in ["429", "quota", "rate", "limit", "resource_exhausted"])
            if is_rate_limit and attempt < max_retries - 1:
                wait_time = (2 ** attempt) * 10  # 10s, 20s, 40s
                print(f"[AI] Rate limit hit (attempt {attempt + 1}/{max_retries}), waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise  # non-rate-limit error or last attempt


def _build_table_block(t: dict) -> str:
    """Build a detailed table block string with column quality data for prompts."""
    cols = t.get("columns", [])
    col_lines = []
    for c in cols:
        q = c.get("quality", {}) or {}
        constraints = []
        if c.get("isPrimaryKey"): constraints.append("PK")
        if c.get("isForeignKey"):
            ref = c.get("foreignKeyRef", {}) or {}
            constraints.append(f"FK→{ref.get('table')}.{ref.get('column')}")
        if not c.get("isNullable"): constraints.append("NOT NULL")
        if c.get("isUnique"): constraints.append("UNIQUE")

        quality_str = ""
        if q:
            parts = []
            if q.get("completeness") is not None: parts.append(f"completeness={q['completeness']:.1f}%")
            if q.get("nullCount") is not None: parts.append(f"nulls={q['nullCount']}")
            if q.get("distinctCount") is not None: parts.append(f"distinct={q['distinctCount']}")
            if q.get("avg") is not None: parts.append(f"avg={q['avg']:.2f}")
            if q.get("min") is not None: parts.append(f"min={q['min']:.2f}")
            if q.get("max") is not None: parts.append(f"max={q['max']:.2f}")
            quality_str = f" [{', '.join(parts)}]" if parts else ""

        col_lines.append(
            f"    - {c['name']} ({c.get('dataType', '?')}) "
            f"[{', '.join(constraints) or 'none'}]{quality_str}"
        )

    flags_str = ", ".join(t.get("qualityFlags", []) or []) or "none"
    return (
        f"TABLE: {t['name']} | rows={t.get('rowCount', 0)} | "
        f"qualityScore={t.get('qualityScore', '?')}/100 | flags={flags_str}\n"
        + "\n".join(col_lines)
    )

def generate_docs_background(snapshot_id: str, mongo_uri: str):
    """
    Background task: single unified Groq/Gemini call to document all tables
    + generate database overview, then build Qdrant embeddings.
    """
    job_status[snapshot_id] = {"status": "running", "progress": 0, "total": 0, "currentTable": "Connecting..."}

    try:
        gemini, qdrant = init_ai()
        ensure_qdrant_collection(qdrant)

        db = _mongo_client["datalens"]
        snapshots_col = db["snapshots"]

        snapshot = None
        for _ in range(5):
            snapshot = snapshots_col.find_one({"_id": ObjectId(snapshot_id)})
            if snapshot:
                break
            time.sleep(2)

        if not snapshot:
            job_status[snapshot_id] = {"status": "failed", "progress": 0, "total": 0, "currentTable": "Snapshot not found"}
            raise ValueError(f"Snapshot {snapshot_id} not found")

        tables = snapshot.get("tables", [])
        total = len(tables)
        job_status[snapshot_id]["total"] = total
        job_status[snapshot_id]["currentTable"] = "Generating AI documentation..."

        table_blocks = [_build_table_block(t) for t in tables]
        all_tables_text = "\n\n".join(table_blocks)
        table_names_json = json.dumps([t["name"] for t in tables])

        unified_prompt = f"""You are a senior data engineer and business analyst.
Analyze ALL of the following database tables including their column-level quality metrics.

=== DATABASE SCHEMA WITH QUALITY DATA ===
{all_tables_text}

=== INSTRUCTIONS ===
Return ONLY a single valid JSON object with NO markdown fences, NO extra text.

The JSON must have exactly this structure:
{{
  "databaseOverview": {{
    "summary": "3-4 sentence executive summary of what this database contains, its business domain, and overall data health",
    "domain": "e.g. E-commerce / Healthcare / Finance / HR",
    "keyEntities": ["entity1", "entity2"],
    "overallHealthAssessment": "Plain English assessment of data quality across the entire database",
    "criticalIssues": ["list of the most important data quality problems found"]
  }},
  "tables": {{
    "<table_name>": {{
      "tableSummary": "2-3 sentence business description including data quality context",
      "usageRecommendations": "How to use this table correctly, what to watch out for",
      "sampleQueries": ["SELECT ... -- comment", "SELECT ..."],
      "columnDescriptions": {{"column_name": "plain English meaning"}},
      "qualityInsight": "Most important quality finding with actionable advice",
      "relatedTables": ["table_name1"]
    }}
  }}
}}

Tables to document: {table_names_json}
Document ALL {len(tables)} tables."""

        try:
            raw = _generate_text(unified_prompt)
            # Strip markdown fences if present
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            
            # Additional cleanup for typical LLM JSON artifacts
            if raw.startswith("json\n"):
                raw = raw[5:]
                
            parsed = json.loads(raw.strip())
            all_docs = parsed.get("tables", {})
            db_overview = parsed.get("databaseOverview", {})
        except Exception as e:
            print(f"[AI] Unified call failed: {e}")
            all_docs = {}
            db_overview = {}

        # Save database overview to MongoDB
        if db_overview:
            snapshots_col.update_one(
                {"_id": ObjectId(snapshot_id)},
                {"$set": {
                    "databaseSummary": db_overview.get("summary", ""),
                    "databaseDomain": db_overview.get("domain", ""),
                    "keyEntities": db_overview.get("keyEntities", []),
                    "overallHealthAssessment": db_overview.get("overallHealthAssessment", ""),
                    "criticalIssues": db_overview.get("criticalIssues", []),
                }}
            )
            print(f"[AI] DB overview saved: {db_overview.get('domain', '?')}")

        qdrant_points = []

        for i, table in enumerate(tables):
            table_name = table["name"]
            job_status[snapshot_id]["currentTable"] = f"Saving {table_name} ({i + 1}/{total})"
            job_status[snapshot_id]["progress"] = i

            ai_data = all_docs.get(table_name) or {
                "tableSummary": f"Documentation pending for {table_name}.",
                "usageRecommendations": "",
                "sampleQueries": [],
                "columnDescriptions": {},
                "qualityInsight": "",
                "relatedTables": [],
            }

            col_descriptions = ai_data.get("columnDescriptions", {})
            updated_columns = []
            for col in table.get("columns", []):
                col["aiDescription"] = col_descriptions.get(col["name"], "")
                updated_columns.append(col)

            snapshots_col.update_one(
                {"_id": ObjectId(snapshot_id), "tables.name": table_name},
                {"$set": {
                    "tables.$.aiSummary": ai_data.get("tableSummary", ""),
                    "tables.$.aiUsageRecommendations": ai_data.get("usageRecommendations", ""),
                    "tables.$.aiSampleQueries": ai_data.get("sampleQueries", []),
                    "tables.$.columns": updated_columns,
                }}
            )

            col_parts = [
                f"{c['name']} ({c.get('dataType', '')}) - {col_descriptions.get(c['name'], '')}"
                for c in updated_columns
            ]
            embedding_text = (
                f"Table: {table_name}. "
                f"Summary: {ai_data.get('tableSummary', '')}. "
                f"Usage: {ai_data.get('usageRecommendations', '')}. "
                f"Quality: {ai_data.get('qualityInsight', '')}. "
                f"Columns: {', '.join(col_parts[:20])}."
            )

            try:
                vector = _get_embedding_with_retry(embedding_text, "RETRIEVAL_DOCUMENT")
                point_id = abs(hash(f"{snapshot_id}_{table_name}")) % (2 ** 63)
                qdrant_points.append(PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "snapshotId": snapshot_id,
                        "tableName": table_name,
                        "tableSummary": ai_data.get("tableSummary", ""),
                        "usageRecommendations": ai_data.get("usageRecommendations", ""),
                        "qualityInsight": ai_data.get("qualityInsight", ""),
                        "qualityScore": table.get("qualityScore"),
                        "qualityFlags": table.get("qualityFlags", []),
                        "sampleQueries": ai_data.get("sampleQueries", []),
                        "relatedTables": ai_data.get("relatedTables", []),
                        "columns": [{"name": c["name"], "description": col_descriptions.get(c["name"], "")} for c in updated_columns],
                    }
                ))
            except Exception as e:
                print(f"[EMBED] Failed for {table_name}: {e}")

        if qdrant_points:
            try:
                qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)
                print(f"[QDRANT] Upserted {len(qdrant_points)} points for snapshot {snapshot_id}")
            except Exception as e:
                print(f"[QDRANT] Upsert failed for snapshot {snapshot_id}: {e}")
        else:
            print(f"[QDRANT] Warning: No points to upsert for snapshot {snapshot_id}. Check embedding or doc generation.")

        snapshots_col.update_one(
            {"_id": ObjectId(snapshot_id)},
            {"$set": {"aiGeneratedAt": datetime.datetime.utcnow().isoformat()}}
        )
        job_status[snapshot_id] = {"status": "complete", "progress": total, "total": total, "currentTable": ""}
        print(f"[AI] Done for snapshot {snapshot_id}: {len(qdrant_points)} tables indexed")

    except Exception as e:
        print(f"[AI] Fatal error for snapshot {snapshot_id}: {e}")
        job_status[snapshot_id] = {"status": "failed", "progress": 0, "total": 0, "currentTable": str(e)}
    finally:
        pass


def re_embed_snapshot(snapshot_id: str, mongo_uri: str) -> dict:
    """Re-embed an existing snapshot without calling the LLM for generation."""
    try:
        _, qdrant = init_ai()
        ensure_qdrant_collection(qdrant)
    except Exception as e:
        return {"status": "error", "message": f"AI service initialization failed: {str(e)}"}

    try:
        db = _mongo_client["datalens"]
        snapshots_col = db["snapshots"]

        snapshot = None
        for _ in range(5):
            snapshot = snapshots_col.find_one({"_id": ObjectId(snapshot_id)})
            if snapshot:
                break
            time.sleep(2)

        if not snapshot:
            raise ValueError(f"Snapshot {snapshot_id} not found")

        tables = snapshot.get("tables", [])
        if not tables:
            return {"status": "error", "message": "No tables in snapshot"}

        qdrant_points = []
        for table in tables:
            table_name = table["name"]
            
            # Use existing documentation from Mongo
            ai_summary = table.get("aiSummary", "")
            ai_usage = table.get("aiUsageRecommendations", "")
            quality_insight = "" # We don't save this separately in table doc, but let's keep it empty
            
            col_parts = [
                f"{c['name']} ({c.get('dataType', '')}) - {c.get('aiDescription', '')}"
                for c in table.get("columns", [])
            ]
            
            embedding_text = (
                f"Table: {table_name}. "
                f"Summary: {ai_summary}. "
                f"Usage: {ai_usage}. "
                f"Quality: {quality_insight}. "
                f"Columns: {', '.join(col_parts[:20])}."
            )
            
            try:
                vector = _get_embedding_with_retry(embedding_text, "RETRIEVAL_DOCUMENT")
                point_id = abs(hash(f"{snapshot_id}_{table_name}")) % (2 ** 63)
                qdrant_points.append(PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "snapshotId": snapshot_id,
                        "tableName": table_name,
                        "tableSummary": ai_summary,
                        "usageRecommendations": ai_usage,
                        "qualityInsight": quality_insight,  
                        "qualityScore": table.get("qualityScore"),
                        "qualityFlags": table.get("qualityFlags", []),
                        "sampleQueries": table.get("aiSampleQueries", []),
                        "relatedTables": [], 
                        "columns": [{"name": c["name"], "description": c.get("aiDescription", "")} for c in table.get("columns", [])],
                    }
                ))
            except Exception as e:
                print(f"[EMBED] Failed for {table_name}: {e}")

        if qdrant_points:
            try:
                qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)
                print(f"[QDRANT] Upserted {len(qdrant_points)} points for snapshot {snapshot_id} (Re-embed)")
            except Exception as e:
                print(f"[QDRANT] Upsert failed for snapshot {snapshot_id}: {e}")
                return {"status": "error", "message": f"Qdrant upsert failed: {str(e)}"}
        else:
            print(f"[QDRANT] Warning: No points to upsert for snapshot {snapshot_id}.")
            return {"status": "error", "message": "No embeddings were generated"}
            
        return {"status": "ok", "tablesIndexed": len(qdrant_points)}
        
    except Exception as e:
        print(f"[AI] Fatal error during RE-EMBED for snapshot {snapshot_id}: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        pass


def rag_chat(question: str, snapshot_id: str, history: list, mongo_uri: str) -> dict:
    """RAG chat: embed → Qdrant search → Groq/Gemini response."""
    try:
        _, qdrant = init_ai()
    except Exception as e:
        return {"answer": f"AI service initialization failed: {str(e)}", "sourceTables": []}

    try:
        query_vector = _get_embedding_with_retry(question, task_type="RETRIEVAL_QUERY")
    except Exception as e:
        return {"answer": f"Failed to embed question: {str(e)}", "sourceTables": []}

    try:
        search_response = qdrant.query_points(
            collection_name=QDRANT_COLLECTION,
            query=query_vector,
            limit=5,
            query_filter=Filter(
                must=[FieldCondition(key="snapshotId", match=MatchValue(value=snapshot_id))]
            ),
            with_payload=True,
            with_vectors=False,
        )
        search_results = search_response.points
    except Exception as e:
        return {
            "answer": f"Vector search failed. AI documentation may not be generated yet — click 'Regen AI Docs' first. Error: {str(e)}",
            "sourceTables": []
        }

    if not search_results:
        return {
            "answer": "No relevant tables found. Please generate AI documentation first by clicking 'Regen AI Docs'.",
            "sourceTables": []
        }

    context_parts = []
    source_tables = []
    for result in search_results:
        p = result.payload
        source_tables.append({"name": p.get("tableName", ""), "relevanceScore": round(result.score * 100, 1)})
        col_summaries = ", ".join([f"{c['name']}: {c['description']}" for c in p.get("columns", [])[:10]])
        context_parts.append(
            f"Table: {p.get('tableName')}\n"
            f"Summary: {p.get('tableSummary')}\n"
            f"Quality: {p.get('qualityScore')}/100 | Flags: {', '.join(p.get('qualityFlags', []) or [])}\n"
            f"Usage: {p.get('usageRecommendations')}\n"
            f"Quality Insight: {p.get('qualityInsight')}\n"
            f"Columns: {col_summaries}\n"
            f"Sample Queries: {'; '.join(p.get('sampleQueries', []))}"
        )

    history_str = "".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}\n"
        for m in history[-10:]
    )

    prompt = f"""You are DataLens AI, an expert database assistant. Answer using ONLY the provided context.
Always include a relevant SQL query when the question is about data retrieval.
Format SQL in code blocks.

## Relevant Table Documentation
{chr(10).join(context_parts)}

## Conversation History
{history_str}

## Question
{question}

Provide a precise, helpful answer. Include a practical SQL query example."""

    try:
        raw_answer = _generate_text(prompt)
        return {"answer": raw_answer, "sourceTables": source_tables}
    except Exception as e:
        return {"answer": f"AI response failed: {str(e)}", "sourceTables": source_tables}


def generate_table_overview(table: dict) -> dict:
    """Generate detailed AI overview for a single table on demand."""
    table_block = _build_table_block(table)

    prompt = f"""You are a senior data engineer and business analyst.
Analyze the following database table including column-level quality metrics.

=== TABLE SCHEMA WITH QUALITY DATA ===
{table_block}

Return ONLY a single valid JSON object with NO markdown fences.

{{
  "tableSummary": "2-3 sentence business description",
  "usageRecommendations": "How to use this table, what to watch out for",
  "sampleQueries": ["SELECT ... -- comment", "SELECT ..."],
  "columnDescriptions": {{"column_name": "plain English meaning"}},
  "qualityInsight": "Most important quality finding with actionable advice",
  "relatedTables": ["table_name1"],
  "analyticalInsights": "3-4 sentences about patterns and anomalies",
  "dataGovernanceNotes": "Compliance or privacy considerations",
  "optimizationTips": "SQL or indexing suggestions"
}}"""

    try:
        raw = _generate_text(prompt)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
            
        if raw.startswith("json\n"):
            raw = raw[5:]            
            
        return json.loads(raw.strip())
    except Exception as e:
        return {
            "tableSummary": f"Overview failed: {str(e)}",
            "usageRecommendations": "", "sampleQueries": [], "columnDescriptions": {},
            "qualityInsight": "", "relatedTables": [], "analyticalInsights": "",
            "dataGovernanceNotes": "", "optimizationTips": ""
        }
