import os
from pathlib import Path

TEST_DB = Path(__file__).resolve().parent / "test.db"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["COLLEGE_EVENT_DB"] = f"sqlite:///{TEST_DB.as_posix()}"
