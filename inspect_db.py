"""
Quick SQLite Database Inspector for College Event Registration Management System.
Run: .\\.venv\\Scripts\\python.exe inspect_db.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "college_events.db"

def inspect():
    if not DB_PATH.exists():
        print(f"[-] Database file not found at: {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    print("=" * 60)
    print(f"DATABASE: {DB_PATH.name}")
    print("=" * 60)
    
    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        
        cursor.execute(f"PRAGMA table_info({table});")
        columns = [col[1] for col in cursor.fetchall()]
        
        print(f"\n--- TABLE: {table} ({count} rows) ---")
        print("Columns: " + ", ".join(columns))
        
        cursor.execute(f"SELECT * FROM {table} LIMIT 10;")
        rows = cursor.fetchall()
        if rows:
            for row in rows:
                print("  ", row)
        else:
            print("   (empty table)")
            
    conn.close()
    print("\n" + "=" * 60)

if __name__ == "__main__":
    inspect()
