import psycopg2
import psycopg2.extras


class PostgresConnector:
    async def extract(self, credentials: dict) -> list:
        conn = psycopg2.connect(
            host=credentials.get("host"),
            port=credentials.get("port", 5432),
            dbname=credentials.get("database"),
            user=credentials.get("username"),
            password=credentials.get("password"),
            connect_timeout=10,
        )
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        cur.execute("""
            SELECT
                t.table_name,
                COALESCE(s.n_live_tup, 0) AS row_count,
                COALESCE(pg_total_relation_size(quote_ident(t.table_name)), 0) AS size_bytes,
                s.last_analyze
            FROM information_schema.tables t
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
            WHERE t.table_schema = 'public'
              AND t.table_type = 'BASE TABLE'
            ORDER BY t.table_name
        """)
        table_rows = cur.fetchall()

        cur.execute("""
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                c.ordinal_position
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
            ORDER BY c.table_name, c.ordinal_position
        """)
        col_rows = cur.fetchall()

        cur.execute("""
            SELECT kcu.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
        """)
        pk_rows = cur.fetchall()
        pks = {}
        for row in pk_rows:
            pks.setdefault(row["table_name"], set()).add(row["column_name"])

        cur.execute("""
            SELECT
                kcu.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
        """)
        fk_rows = cur.fetchall()
        fks = {}
        for row in fk_rows:
            fks[(row["table_name"], row["column_name"])] = {
                "table": row["foreign_table_name"],
                "column": row["foreign_column_name"],
            }

        referenced_by = {}
        for (tn, cn), ref in fks.items():
            referenced_by.setdefault(ref["table"], []).append({"table": tn, "column": cn})

        cur.execute("""
            SELECT kcu.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
              AND tc.table_schema = 'public'
        """)
        unique_rows = cur.fetchall()
        unique_cols = {}
        for row in unique_rows:
            unique_cols.setdefault(row["table_name"], set()).add(row["column_name"])

        cur.execute("""
            SELECT
                t.relname AS table_name,
                a.attname AS column_name
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relkind = 'r'
        """)
        index_rows = cur.fetchall()
        indexed_cols = {}
        for row in index_rows:
            indexed_cols.setdefault(row["table_name"], set()).add(row["column_name"])

        cols_by_table = {}
        for row in col_rows:
            tn = row["table_name"]
            cn = row["column_name"]
            cols_by_table.setdefault(tn, []).append({
                "name": cn,
                "dataType": row["data_type"],
                "isNullable": row["is_nullable"] == "YES",
                "defaultValue": str(row["column_default"]) if row["column_default"] else None,
                "isPrimaryKey": cn in pks.get(tn, set()),
                "isForeignKey": (tn, cn) in fks,
                "isUnique": cn in unique_cols.get(tn, set()),
                "isIndexed": cn in indexed_cols.get(tn, set()),
                "foreignKeyRef": fks.get((tn, cn)),
            })

        tables = []
        for row in table_rows:
            tn = row["table_name"]
            tables.append({
                "name": tn,
                "rowCount": int(row["row_count"]),
                "sizeBytes": int(row["size_bytes"]),
                "lastModified": row["last_analyze"].isoformat() if row["last_analyze"] else None,
                "columns": cols_by_table.get(tn, []),
                "referencedBy": referenced_by.get(tn, []),
            })

        cur.close()
        conn.close()
        return tables
