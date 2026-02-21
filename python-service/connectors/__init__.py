from connectors.postgres import PostgresConnector
from connectors.mysql import MySQLConnector
from connectors.mssql import MSSQLConnector
from connectors.snowflake import SnowflakeConnector


def get_connector(db_type: str):
    """Factory function returning the correct database connector."""
    connectors = {
        "postgres": PostgresConnector,
        "mysql": MySQLConnector,
        "mssql": MSSQLConnector,
        "snowflake": SnowflakeConnector,
    }
    cls = connectors.get(db_type)
    if cls is None:
        raise ValueError(f"Unsupported database type: {db_type}")
    return cls()
