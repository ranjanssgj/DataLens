import mysql.connector


class MySQLConnector:
    async def extract(self, credentials: dict) -> list:
        conn = mysql.connector.connect(
            host=credentials.get("host"),
            port=int(credentials.get("port", 3306)),
            database=credentials.get("database"),
            user=credentials.get("username"),
            password=credentials.get("password"),
            connection_timeout=10,
        )
        cur = conn.cursor(dictionary=True)
        db = credentials.get("database")

        cur.execute("""
            SELECT
                table_name,
                COALESCE(table_rows, 0) AS row_count,
                COALESCE(data_length + index_length, 0) AS size_bytes,
                update_time AS last_modified
            FROM information_schema.TABLES
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """, (db,))
        table_rows = cur.fetchall()

        cur.execute("""
            SELECT
                table_name,
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position,
                column_key
            FROM information_schema.COLUMNS
            WHERE table_schema = %s
            ORDER BY table_name, ordinal_position
        """, (db,))
        col_rows = cur.fetchall()

        cur.execute("""
            SELECT
                kcu.table_name,
                kcu.column_name,
                kcu.referenced_table_name,
                kcu.referenced_column_name
            FROM information_schema.KEY_COLUMN_USAGE kcu
            JOIN information_schema.TABLE_CONSTRAINTS tc
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE kcu.table_schema = %s
              AND tc.constraint_type = 'FOREIGN KEY'
        """, (db,))
        fk_rows = cur.fetchall()
        fks = {}
        for row in fk_rows:
            fks[(row["table_name"], row["column_name"])] = {
                "table": row["referenced_table_name"],
                "column": row["referenced_column_name"],
            }

        referenced_by = {}
        for (tn, cn), ref in fks.items():
            referenced_by.setdefault(ref["table"], []).append({"table": tn, "column": cn})

        cols_by_table = {}
        for row in col_rows:
            tn = row["table_name"]
            cn = row["column_name"]
            key = row.get("column_key", "")
            cols_by_table.setdefault(tn, []).append({
                "name": cn,
                "dataType": row["data_type"],
                "isNullable": row["is_nullable"] == "YES",
                "defaultValue": str(row["column_default"]) if row["column_default"] is not None else None,
                "isPrimaryKey": key == "PRI",
                "isForeignKey": (tn, cn) in fks,
                "isUnique": key == "UNI",
                "isIndexed": key in ("PRI", "UNI", "MUL"),
                "foreignKeyRef": fks.get((tn, cn)),
            })

        tables = []
        for row in table_rows:
            tn = row["table_name"]
            tables.append({
                "name": tn,
                "rowCount": int(row["row_count"]),
                "sizeBytes": int(row["size_bytes"]),
                "lastModified": row["last_modified"].isoformat() if row["last_modified"] else None,
                "columns": cols_by_table.get(tn, []),
                "referencedBy": referenced_by.get(tn, []),
            })

        cur.close()
        conn.close()
        return tables
