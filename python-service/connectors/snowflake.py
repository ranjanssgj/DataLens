import snowflake.connector


class SnowflakeConnector:
    async def extract(self, credentials: dict) -> list:
        conn = snowflake.connector.connect(
            account=credentials.get("account"),
            user=credentials.get("username"),
            password=credentials.get("password"),
            database=credentials.get("database"),
            warehouse=credentials.get("warehouse"),
            schema=credentials.get("schema", "PUBLIC"),
        )
        cur = conn.cursor(snowflake.connector.DictCursor)
        db = credentials.get("database").upper()
        schema = credentials.get("schema", "PUBLIC").upper()

        cur.execute(f"""
            SELECT
                TABLE_NAME,
                ROW_COUNT,
                BYTES AS SIZE_BYTES,
                LAST_ALTERED AS LAST_MODIFIED
            FROM {db}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '{schema}'
              AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        """)
        table_rows = cur.fetchall()

        cur.execute(f"""
            SELECT
                TABLE_NAME,
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                ORDINAL_POSITION
            FROM {db}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{schema}'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        col_rows = cur.fetchall()

        cols_by_table = {}
        for row in col_rows:
            tn = row["TABLE_NAME"]
            cn = row["COLUMN_NAME"]
            cols_by_table.setdefault(tn, []).append({
                "name": cn,
                "dataType": row["DATA_TYPE"],
                "isNullable": row["IS_NULLABLE"] == "YES",
                "defaultValue": str(row["COLUMN_DEFAULT"]) if row["COLUMN_DEFAULT"] else None,
                "isPrimaryKey": False,
                "isForeignKey": False,
                "isUnique": False,
                "isIndexed": False,
                "foreignKeyRef": None,
            })

        tables = []
        for row in table_rows:
            tn = row["TABLE_NAME"]
            tables.append({
                "name": tn,
                "rowCount": int(row["ROW_COUNT"] or 0),
                "sizeBytes": int(row["SIZE_BYTES"] or 0),
                "lastModified": row["LAST_MODIFIED"].isoformat() if row["LAST_MODIFIED"] else None,
                "columns": cols_by_table.get(tn, []),
                "referencedBy": [],
            })

        cur.close()
        conn.close()
        return tables
