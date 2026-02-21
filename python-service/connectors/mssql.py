import pyodbc


class MSSQLConnector:
    async def extract(self, credentials: dict) -> list:
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={credentials.get('host')},{credentials.get('port', 1433)};"
            f"DATABASE={credentials.get('database')};"
            f"UID={credentials.get('username')};"
            f"PWD={credentials.get('password')}"
        )
        conn = pyodbc.connect(conn_str, timeout=10)
        cur = conn.cursor()

        cur.execute("""
            SELECT
                t.name AS table_name,
                p.rows AS row_count,
                SUM(a.total_pages) * 8 * 1024 AS size_bytes
            FROM sys.tables t
            JOIN sys.indexes i ON t.object_id = i.object_id AND i.index_id <= 1
            JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
            JOIN sys.allocation_units a ON p.partition_id = a.container_id
            GROUP BY t.name, p.rows
            ORDER BY t.name
        """)
        table_rows = [{"table_name": r[0], "row_count": r[1], "size_bytes": r[2]} for r in cur.fetchall()]

        cur.execute("""
            SELECT
                t.name AS table_name,
                c.name AS column_name,
                tp.name AS data_type,
                c.is_nullable,
                c.column_id
            FROM sys.tables t
            JOIN sys.columns c ON t.object_id = c.object_id
            JOIN sys.types tp ON c.user_type_id = tp.user_type_id
            ORDER BY t.name, c.column_id
        """)
        col_rows = [{"table_name": r[0], "column_name": r[1], "data_type": r[2], "is_nullable": r[3]} for r in cur.fetchall()]

        cur.execute("""
            SELECT t.name AS table_name, c.name AS column_name
            FROM sys.tables t
            JOIN sys.indexes i ON t.object_id = i.object_id AND i.is_primary_key = 1
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        """)
        pks = {}
        for tn, cn in cur.fetchall():
            pks.setdefault(tn, set()).add(cn)

        cur.execute("""
            SELECT
                OBJECT_NAME(fkc.parent_object_id) AS table_name,
                COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
                OBJECT_NAME(fkc.referenced_object_id) AS ref_table,
                COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_column
            FROM sys.foreign_key_columns fkc
        """)
        fks = {}
        for tn, cn, rt, rc in cur.fetchall():
            fks[(tn, cn)] = {"table": rt, "column": rc}

        referenced_by = {}
        for (tn, cn), ref in fks.items():
            referenced_by.setdefault(ref["table"], []).append({"table": tn, "column": cn})

        cur.execute("""
            SELECT DISTINCT t.name AS table_name, c.name AS column_name
            FROM sys.tables t
            JOIN sys.index_columns ic ON t.object_id = ic.object_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        """)
        indexed_cols = {}
        for tn, cn in cur.fetchall():
            indexed_cols.setdefault(tn, set()).add(cn)

        cols_by_table = {}
        for row in col_rows:
            tn = row["table_name"]
            cn = row["column_name"]
            cols_by_table.setdefault(tn, []).append({
                "name": cn,
                "dataType": row["data_type"],
                "isNullable": bool(row["is_nullable"]),
                "defaultValue": None,
                "isPrimaryKey": cn in pks.get(tn, set()),
                "isForeignKey": (tn, cn) in fks,
                "isUnique": False,
                "isIndexed": cn in indexed_cols.get(tn, set()),
                "foreignKeyRef": fks.get((tn, cn)),
            })

        tables = []
        for row in table_rows:
            tn = row["table_name"]
            tables.append({
                "name": tn,
                "rowCount": int(row["row_count"] or 0),
                "sizeBytes": int(row["size_bytes"] or 0),
                "lastModified": None,
                "columns": cols_by_table.get(tn, []),
                "referencedBy": referenced_by.get(tn, []),
            })

        cur.close()
        conn.close()
        return tables
