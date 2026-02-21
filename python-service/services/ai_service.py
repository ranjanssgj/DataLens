import os
import json
import datetime
import pymongo
from google import genai
from google.genai import types as genai_types
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


QDRANT_COLLECTION = "table_docs"
VECTOR_SIZE = 768  # text-embedding-004 default output

job_status = {}
_gemini_client = None


def init_ai():
    """Initialize Gemini client and Qdrant client."""
    global _gemini_client
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=api_key)
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
            print(f"[QDRANT] Vector size mismatch, recreating collection...")
            qdrant.delete_collection(QDRANT_COLLECTION)
        else:
            return
    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"[QDRANT] Created collection with {VECTOR_SIZE}-dim cosine vectors")


def _build_schema_summary(table: dict) -> str:
    """Compact one-liner schema for batch prompt context."""
    cols = table.get("columns", [])
    pks = [c["name"] for c in cols if c.get("isPrimaryKey")]
    fks = [f"{c['name']}→{c['foreignKeyRef']['table']}.{c['foreignKeyRef']['column']}"
           for c in cols if c.get("isForeignKey") and c.get("foreignKeyRef")]
    col_list = ", ".join(c["name"] for c in cols[:12])
    extras = []
    if pks: extras.append(f"PK: {', '.join(pks)}")
    if fks: extras.append(f"FK: {'; '.join(fks)}")
    quality = table.get("qualityScore")
    flags = table.get("qualityFlags", [])
    return (
        f"Table `{table['name']}`: {table.get('rowCount', 0)} rows, {len(cols)} columns. "
        f"Columns: {col_list}. "
        + (f"Quality: {quality}/100. " if quality is not None else "")
        + (f"Issues: {'; '.join(flags[:2])}. " if flags else "")
        + (" | ".join(extras))
    )


def _get_embedding(client: genai.Client, text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    """Get a text embedding."""
    response = client.models.embed_content(
        model="text-embedding-004",
        contents=text,
        config=genai_types.EmbedContentConfig(task_type=task_type),
    )
    return response.embeddings[0].values


def generate_docs_background(snapshot_id: str, mongo_uri: str):
    """
    Background task: single batch Gemini call to document all tables at once,
    then build embeddings for Qdrant indexing.
    """
    job_status[snapshot_id] = {"status": "running", "progress": 0, "total": 0, "currentTable": "Connecting..."}

    mongo_client = None
    try:
        gemini, qdrant = init_ai()
        ensure_qdrant_collection(qdrant)

        mongo_client = pymongo.MongoClient(mongo_uri)
        db = mongo_client["datalens"]
        snapshots_col = db["snapshots"]

        snapshot = snapshots_col.find_one({"_id": ObjectId(snapshot_id)})
        if not snapshot:
            job_status[snapshot_id] = {"status": "failed", "progress": 0, "total": 0, "currentTable": "Snapshot not found"}
            return

        tables = snapshot.get("tables", [])
        total = len(tables)
        job_status[snapshot_id]["total"] = total
        job_status[snapshot_id]["currentTable"] = "Calling Gemini (single batch call)..."

        # ── Single batch call: all tables documented in one prompt ────────────
        schema_lines = "\n".join(f"{i+1}. {_build_schema_summary(t)}" for i, t in enumerate(tables))
        table_names_json = json.dumps([t["name"] for t in tables])

        batch_prompt = f"""You are a senior data engineer. Document ALL of the following database tables in one response.

Database tables:
{schema_lines}

Return ONLY valid JSON — an object where each key is a table name, and the value follows this exact structure:
{{
  "<table_name>": {{
    "tableSummary": "2-3 sentence business description",
    "usageRecommendations": "How analysts should use this table, any caveats",
    "sampleQueries": ["SELECT ...", "SELECT ..."],
    "columnDescriptions": {{"column_name": "plain English description"}},
    "qualityInsight": "Key data quality observations",
    "relatedTables": ["table_name1"]
  }}
}}

Tables to document: {table_names_json}
Document ALL {total} tables. Return only the JSON object, no markdown fences."""

        try:
            response = gemini.models.generate_content(
                model="gemini-2.0-flash",
                contents=batch_prompt,
            )
            raw = response.text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            all_docs = json.loads(raw.strip())
        except Exception as e:
            print(f"[AI] Batch call failed: {e}. Falling back to empty docs.")
            all_docs = {}

        # ── Database-level summary from the batch response ────────────────────
        # Build a DB summary from what we got
        db_summary_prompt = f"""Given these table names, give a brief executive summary.
Tables: {', '.join(t['name'] for t in tables)}
Return ONLY valid JSON: {{"databaseSummary": "...", "domain": "e.g. E-commerce", "keyEntities": ["..."]}}"""
        try:
            db_resp = gemini.models.generate_content(model="gemini-2.0-flash", contents=db_summary_prompt)
            db_raw = db_resp.text.strip().replace("```json", "").replace("```", "").strip()
            db_ai = json.loads(db_raw)
            snapshots_col.update_one(
                {"_id": ObjectId(snapshot_id)},
                {"$set": {
                    "databaseSummary": db_ai.get("databaseSummary", ""),
                    "databaseDomain": db_ai.get("domain", ""),
                    "keyEntities": db_ai.get("keyEntities", []),
                }}
            )
            print(f"[AI] DB summary: {db_ai.get('domain', '?')}")
        except Exception as e:
            print(f"[AI] DB summary failed: {e}")

        # ── Save per-table docs and build Qdrant points ───────────────────────
        qdrant_points = []

        for i, table in enumerate(tables):
            table_name = table["name"]
            job_status[snapshot_id]["currentTable"] = f"Saving {table_name} ({i+1}/{total})"
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

            # Build embedding text
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
                vector = _get_embedding(gemini, embedding_text, "RETRIEVAL_DOCUMENT")
                point_id = abs(hash(f"{snapshot_id}_{table_name}")) % (2**63)
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
            qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)

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
        if mongo_client:
            try:
                mongo_client.close()
            except Exception:
                pass


def rag_chat(question: str, snapshot_id: str, history: list, mongo_uri: str) -> dict:
    """RAG chat: embed question, search Qdrant, call Gemini."""
    gemini, qdrant = init_ai()

    query_vector = _get_embedding(gemini, question, "RETRIEVAL_QUERY")

    search_results = qdrant.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        limit=5,
        query_filter=Filter(
            must=[FieldCondition(key="snapshotId", match=MatchValue(value=snapshot_id))]
        ),
        with_payload=True,
        with_vectors=False,
    )

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
            f"Columns: {col_summaries}\n"
            f"Sample Queries: {'; '.join(p.get('sampleQueries', []))}"
        )

    history_str = "".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}\n"
        for m in history[-10:]
    )

    prompt = f"""You are DataLens AI, an expert database assistant. Answer using ONLY the provided context.

## Relevant Table Documentation
{chr(10).join(context_parts)}

## Conversation History
{history_str}
## Question
{question}

Provide a precise answer. Include SQL examples where helpful."""

    response = gemini.models.generate_content(model="gemini-2.0-flash", contents=prompt)
    return {"answer": response.text, "sourceTables": source_tables}
