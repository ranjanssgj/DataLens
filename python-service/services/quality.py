import pandas as pd
import numpy as np
from scipy import stats as scipy_stats
import pymongo
import os
from bson import ObjectId


def run_quality_analysis(snapshot_id: str, credentials: dict):
    """
    Run quality analysis for all tables in a snapshot.
    Writes results directly to MongoDB snapshot document.
    """
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/datalens")
    client = pymongo.MongoClient(mongo_uri)
    db = client["datalens"]
    snapshots_col = db["snapshots"]

    snapshot = snapshots_col.find_one({"_id": ObjectId(snapshot_id)})
    if not snapshot:
        client.close()
        raise ValueError(f"Snapshot {snapshot_id} not found")

    db_type = snapshot.get("dbType")
    tables = snapshot.get("tables", [])

    conn = _get_db_connection(db_type, credentials)

    updated_tables = []
    for table in tables:
        table_name = table["name"]
        columns = table.get("columns", [])
        col_names = [c["name"] for c in columns]

        quality_flags = []
        quality_score = 100

        try:
            df = _load_sample(conn, db_type, table_name, col_names)
        except Exception as e:
            print(f"[QUALITY] Could not sample {table_name}: {e}")
            table["qualityScore"] = 50
            table["qualityFlags"] = ["Could not load sample data for analysis"]
            updated_tables.append(table)
            continue

        row_count = max(len(df), 1)

        updated_columns = []
        for col in columns:
            cn = col["name"]
            if cn not in df.columns:
                updated_columns.append(col)
                continue

            series = df[cn]
            null_count = int(series.isna().sum())
            distinct_count = int(series.nunique())
            completeness = round((1 - null_count / row_count) * 100, 2)
            uniqueness_ratio = round(distinct_count / row_count, 4) if row_count > 0 else 0

            q = {
                "completeness": completeness,
                "nullCount": null_count,
                "distinctCount": distinct_count,
                "uniquenessRatio": uniqueness_ratio,
            }

            numeric_series = pd.to_numeric(series, errors="coerce").dropna()
            if len(numeric_series) >= 5:
                q["min"] = float(numeric_series.min())
                q["max"] = float(numeric_series.max())
                q["avg"] = float(numeric_series.mean())
                q["stdDev"] = float(numeric_series.std())
                desc = numeric_series.describe(percentiles=[0.25, 0.5, 0.75, 0.95])
                q["p25"] = float(desc.get("25%", np.nan)) if not np.isnan(desc.get("25%", np.nan)) else None
                q["p50"] = float(desc.get("50%", np.nan)) if not np.isnan(desc.get("50%", np.nan)) else None
                q["p75"] = float(desc.get("75%", np.nan)) if not np.isnan(desc.get("75%", np.nan)) else None
                q["p95"] = float(desc.get("95%", np.nan)) if not np.isnan(desc.get("95%", np.nan)) else None

                try:
                    q["skewness"] = float(scipy_stats.skew(numeric_series))
                    q["kurtosis"] = float(scipy_stats.kurtosis(numeric_series))
                except Exception:
                    q["skewness"] = None
                    q["kurtosis"] = None

                q1 = numeric_series.quantile(0.25)
                q3 = numeric_series.quantile(0.75)
                iqr = q3 - q1
                outlier_mask = (numeric_series < q1 - 1.5 * iqr) | (numeric_series > q3 + 1.5 * iqr)
                outlier_count = int(outlier_mask.sum())

                if numeric_series.std() > 0:
                    z_scores = np.abs(scipy_stats.zscore(numeric_series))
                    z_outliers = int((z_scores > 3).sum())
                    outlier_count = max(outlier_count, z_outliers)

                q["outlierCount"] = outlier_count
                q["outlierPct"] = round(outlier_count / row_count * 100, 2)

            if completeness < 80:
                quality_flags.append(f"Column '{cn}' is only {completeness:.0f}% complete")
                quality_score -= min(10, (80 - completeness) / 4)

            col["quality"] = q
            updated_columns.append(col)

        table["columns"] = updated_columns

        pk_cols = [c["name"] for c in columns if c.get("isPrimaryKey")]
        if pk_cols:
            try:
                pk_series = df[pk_cols[0]] if pk_cols[0] in df.columns else None
                if pk_series is not None and pk_series.duplicated().any():
                    quality_flags.append(f"Primary key column '{pk_cols[0]}' has duplicate values")
                    quality_score -= 20
            except Exception:
                pass

        datetime_cols = [c["name"] for c in columns if any(dt in c.get("dataType", "").lower() for dt in ["date", "time", "timestamp"])]
        for dcol in datetime_cols:
            if dcol in df.columns:
                try:
                    dt_series = pd.to_datetime(df[dcol], errors="coerce").dropna()
                    if len(dt_series) > 0:
                        days_old = (pd.Timestamp.now() - dt_series.max()).days
                        if days_old > 90:
                            quality_flags.append(f"Data may be stale — newest '{dcol}' value is {days_old} days old")
                            quality_score -= 5
                except Exception:
                    pass

        fk_cols = [c for c in columns if c.get("isForeignKey") and c.get("foreignKeyRef")]
        for fk_col in fk_cols[:3]:
            try:
                ref = fk_col["foreignKeyRef"]
                result = _check_fk_integrity(conn, db_type, table_name, fk_col["name"], ref["table"], ref["column"])
                if result > 0:
                    quality_flags.append(f"FK column '{fk_col['name']}' has {result} orphaned references to '{ref['table']}'")
                    quality_score -= min(15, result)
            except Exception:
                pass

        table["qualityScore"] = max(0, round(quality_score))
        table["qualityFlags"] = quality_flags
        updated_tables.append(table)

    snapshots_col.update_one(
        {"_id": ObjectId(snapshot_id)},
        {"$set": {
            "tables": updated_tables,
            "qualityAnalyzedAt": pd.Timestamp.now().isoformat(),
        }}
    )
    client.close()
    return len(updated_tables)


def _get_db_connection(db_type: str, credentials: dict):
    if db_type == "postgres":
        import psycopg2
        return psycopg2.connect(
            host=credentials.get("host"),
            port=credentials.get("port", 5432),
            dbname=credentials.get("database"),
            user=credentials.get("username"),
            password=credentials.get("password"),
            connect_timeout=10,
        )
    elif db_type == "mysql":
        import mysql.connector
        return mysql.connector.connect(
            host=credentials.get("host"),
            port=int(credentials.get("port", 3306)),
            database=credentials.get("database"),
            user=credentials.get("username"),
            password=credentials.get("password"),
        )
    elif db_type == "mssql":
        import pyodbc
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={credentials.get('host')},{credentials.get('port', 1433)};"
            f"DATABASE={credentials.get('database')};"
            f"UID={credentials.get('username')};"
            f"PWD={credentials.get('password')}"
        )
        return pyodbc.connect(conn_str, timeout=10)
    else:
        raise ValueError(f"Unsupported db_type for quality analysis: {db_type}")


def _load_sample(conn, db_type: str, table_name: str, col_names: list) -> pd.DataFrame:
    safe_table = f'"{table_name}"' if db_type == "postgres" else f"`{table_name}`" if db_type == "mysql" else f"[{table_name}]"
    if db_type == "mssql":
        query = f"SELECT TOP 10000 * FROM {safe_table}"
    else:
        query = f"SELECT * FROM {safe_table} LIMIT 10000"
    return pd.read_sql(query, conn)


def _check_fk_integrity(conn, db_type: str, table: str, col: str, ref_table: str, ref_col: str) -> int:
    if db_type == "postgres":
        t_q = f'"{table}"'
        rt_q = f'"{ref_table}"'
        c_q = f'"{col}"'
        rc_q = f'"{ref_col}"'
        query = f"""
            SELECT COUNT(*) FROM {t_q} t
            LEFT JOIN {rt_q} r ON t.{c_q} = r.{rc_q}
            WHERE t.{c_q} IS NOT NULL AND r.{rc_q} IS NULL
        """
    elif db_type == "mysql":
        query = f"""
            SELECT COUNT(*) FROM `{table}` t
            LEFT JOIN `{ref_table}` r ON t.`{col}` = r.`{ref_col}`
            WHERE t.`{col}` IS NOT NULL AND r.`{ref_col}` IS NULL
        """
    elif db_type == "mssql":
        query = f"""
            SELECT COUNT(*) FROM [{table}] t
            LEFT JOIN [{ref_table}] r ON t.[{col}] = r.[{ref_col}]
            WHERE t.[{col}] IS NOT NULL AND r.[{ref_col}] IS NULL
        """
    else:
        return 0

    cur = conn.cursor()
    cur.execute(query)
    result = cur.fetchone()
    return int(result[0]) if result else 0
