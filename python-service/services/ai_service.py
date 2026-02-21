import os
import time
import json
import datetime
import pymongo
import google.generativeai as genai
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
VECTOR_SIZE = 768

job_status = {}


def init_ai():
    """Initialize Gemini and Qdrant clients."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    genai.configure(api_key=api_key)
    return QdrantClient(
        url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        api_key=os.getenv("QDRANT_API_KEY")
    )


def ensure_qdrant_collection(qdrant: QdrantClient):
    """Create or recreate the Qdrant collection with the correct vector size."""
    collections = qdrant.get_collections().collections
    existing = {c.name: c for c in collections}

    if QDRANT_COLLECTION in existing:
        col_info = qdrant.get_collection(QDRANT_COLLECTION)
        existing_size = col_info.config.params.vectors.size
        if existing_size != VECTOR_SIZE:
            print(f"[QDRANT] Vector size mismatch ({existing_size} vs {VECTOR_SIZE}), recreating collection...")
            qdrant.delete_collection(QDRANT_COLLECTION)
        else:
            return 

    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"[QDRANT] Created collection '{QDRANT_COLLECTION}' with {VECTOR_SIZE}-dim cosine vectors")


def build_table_prompt(table: dict) -> str:
    """Build a rich Gemini prompt from table schema and quality data."""
    lines = []
    lines.append(f"You are a senior data engineer. Document the following database table as a business data dictionary entry.")
    lines.append(f"\n## Table: {table['name']}")
    lines.append(f"- Row Count: {table.get('rowCount', 'unknown')}")
    lines.append(f"- Size: {table.get('sizeBytes', 0)} bytes")
    lines.append(f"- Last Modified: {table.get('lastModified', 'unknown')}")
    lines.append(f"- Overall Quality Score: {table.get('qualityScore', 'N/A')}/100")

    flags = table.get("qualityFlags", [])
    if flags:
        lines.append("\n### Quality Warnings:")
        for f in flags:
            lines.append(f"  - {f}")

    lines.append("\n### Columns:")
    for col in table.get("columns", []):
        constraints = []
        if col.get("isPrimaryKey"):
            constraints.append("PRIMARY KEY")
        if col.get("isForeignKey"):
            ref = col.get("foreignKeyRef", {})
            constraints.append(f"FK -> {ref.get('table')}.{ref.get('column')}")
        if not col.get("isNullable"):
            constraints.append("NOT NULL")
        if col.get("isUnique"):
            constraints.append("UNIQUE")
        if col.get("isIndexed"):
            constraints.append("INDEXED")
        q = col.get("quality", {})
        q_summary = ""
        if q:
            parts = []
            if q.get("completeness") is not None:
                parts.append(f"completeness={q['completeness']:.1f}%")
            if q.get("nullCount") is not None:
                parts.append(f"nulls={q['nullCount']}")
            if q.get("distinctCount") is not None:
                parts.append(f"distinct={q['distinctCount']}")
            if q.get("avg") is not None:
                parts.append(f"avg={q['avg']:.2f}")
            if q.get("min") is not None and q.get("max") is not None:
                parts.append(f"range=[{q['min']:.2f},{q['max']:.2f}]")
            if q.get("p50") is not None:
                parts.append(f"p50={q['p50']:.2f}")
            if q.get("p95") is not None:
                parts.append(f"p95={q['p95']:.2f}")
            if q.get("skewness") is not None:
                parts.append(f"skew={q['skewness']:.2f}")
            if q.get("outlierPct") is not None:
                parts.append(f"outliers={q['outlierPct']:.1f}%")
            q_summary = " | " + ", ".join(parts) if parts else ""
        lines.append(f"  - {col['name']} ({col.get('dataType', 'unknown')}) [{', '.join(constraints)}]{q_summary}")

    fk_cols = [c for c in table.get("columns", []) if c.get("isForeignKey")]
    if fk_cols:
        lines.append("\n### Foreign Key Relationships:")
        for col in fk_cols:
            ref = col.get("foreignKeyRef", {})
            lines.append(f"  - {col['name']} -> {ref.get('table')}.{ref.get('column')}")

    referenced_by = table.get("referencedBy", [])
    if referenced_by:
        lines.append("\n### Referenced By:")
        for ref in referenced_by:
            lines.append(f"  - {ref['table']}.{ref['column']}")

    lines.append("""
Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "tableSummary": "2-3 sentence business description of what this table stores and its purpose",
  "usageRecommendations": "How analysts and engineers should use this table, any caveats",
  "sampleQueries": ["SELECT ...", "SELECT ..."],
  "columnDescriptions": {"column_name": "plain English description"},
  "qualityInsight": "Key data quality observations and recommended actions",
  "relatedTables": ["table_name1", "table_name2"]
}""")
    return "\n".join(lines)


def generate_docs_background(snapshot_id: str, mongo_uri: str):
    """
    Background task: generate AI documentation for all tables in a snapshot,
    build embeddings, and upsert into Qdrant.
    """
    job_status[snapshot_id] = {"status": "running", "progress": 0, "total": 0, "currentTable": ""}

    try:
        qdrant = init_ai()
        ensure_qdrant_collection(qdrant)

        model = genai.GenerativeModel("gemini-1.5-flash")
        embedding_model = "models/text-embedding-004"

        client = pymongo.MongoClient(mongo_uri)
        db = client["datalens"]
        snapshots_col = db["snapshots"]

        snapshot = snapshots_col.find_one({"_id": ObjectId(snapshot_id)})
        if not snapshot:
            job_status[snapshot_id] = {"status": "failed", "progress": 0, "total": 0, "currentTable": ""}
            return

        tables = snapshot.get("tables", [])
        total = len(tables)
        job_status[snapshot_id]["total"] = total

        qdrant_points = []

        for i, table in enumerate(tables):
            table_name = table["name"]
            job_status[snapshot_id]["currentTable"] = table_name
            job_status[snapshot_id]["progress"] = i

            try:
                prompt = build_table_prompt(table)
                response = model.generate_content(prompt)
                raw_text = response.text.strip()

                if raw_text.startswith("```"):
                    raw_text = raw_text.split("\n", 1)[1]
                if raw_text.endswith("```"):
                    raw_text = raw_text.rsplit("```", 1)[0]

                ai_data = json.loads(raw_text)
            except Exception as e:
                print(f"[AI] Failed to generate docs for {table_name}: {e}")
                ai_data = {
                    "tableSummary": f"Documentation unavailable for {table_name}",
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
                "{} ({}) - {}".format(c["name"], c.get("dataType", ""), col_descriptions.get(c["name"], ""))
                for c in updated_columns
            ]
            embedding_text = (
                "Table: {}. Summary: {}. Usage: {}. Quality: {}. Flags: {}. Columns: {}. Related: {}.".format(
                    table_name,
                    ai_data.get("tableSummary", ""),
                    ai_data.get("usageRecommendations", ""),
                    ai_data.get("qualityInsight", ""),
                    ", ".join(table.get("qualityFlags", [])),
                    ", ".join(col_parts),
                    ", ".join(ai_data.get("relatedTables", [])),
                )
            )

            try:
                embed_response = genai.embed_content(
                    model=embedding_model,
                    content=embedding_text,
                    task_type="RETRIEVAL_DOCUMENT",
                )
                vector = embed_response["embedding"]
            except Exception as e:
                print(f"[EMBED] Failed for {table_name}: {e}")
                time.sleep(1)
                continue

            point_id = abs(hash(f"{snapshot_id}_{table_name}")) % (2**63)
            payload = {
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
            qdrant_points.append(PointStruct(id=point_id, vector=vector, payload=payload))

            time.sleep(1)

        if qdrant_points:
            qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_points)

        snapshots_col.update_one(
            {"_id": ObjectId(snapshot_id)},
            {"$set": {"aiGeneratedAt": datetime.datetime.utcnow().isoformat()}}
        )
        job_status[snapshot_id] = {"status": "complete", "progress": total, "total": total, "currentTable": ""}
        print(f"[AI] Completed documentation for snapshot {snapshot_id}: {len(qdrant_points)} tables indexed")

    except Exception as e:
        print(f"[AI] Fatal error for snapshot {snapshot_id}: {e}")
        job_status[snapshot_id] = {"status": "failed", "progress": 0, "total": 0, "currentTable": str(e)}
    finally:
        try:
            client.close()
        except Exception:
            pass


def rag_chat(question: str, snapshot_id: str, history: list, mongo_uri: str) -> dict:
    """
    RAG chat: embed question, search Qdrant, build focused prompt, call Gemini.
    """
    qdrant = init_ai()
    model = genai.GenerativeModel("gemini-1.5-flash")
    embedding_model = "models/text-embedding-004"

    embed_response = genai.embed_content(
        model=embedding_model,
        content=question,
        task_type="RETRIEVAL_QUERY",
    )
    query_vector = embed_response["embedding"]

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
        relevance_pct = round(result.score * 100, 1)
        source_tables.append({"name": p.get("tableName", ""), "relevanceScore": relevance_pct})
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

    context = "\n\n---\n\n".join(context_parts)

    history_str = ""
    for msg in history[-10:]:
        role = "User" if msg.get("role") == "user" else "Assistant"
        history_str += f"{role}: {msg.get('content', '')}\n"

    prompt = f"""You are DataLens AI, an expert database assistant. Answer the user's question using ONLY the provided table documentation context. If the answer requires SQL, provide well-formatted queries.

## Relevant Table Documentation
{context}

## Conversation History
{history_str}

## User Question
{question}

Provide a precise, helpful answer. Reference specific tables, columns, and quality issues where relevant. If you suggest SQL queries, make them practical and immediately usable."""

    response = model.generate_content(prompt)
    return {
        "answer": response.text,
        "sourceTables": source_tables,
    }
