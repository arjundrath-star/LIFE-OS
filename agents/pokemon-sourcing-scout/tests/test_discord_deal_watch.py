import contextlib, importlib.util, io, os, sqlite3, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
SCRIPT=Path(__file__).parents[1]/"scripts"/"discord_deal_watch.py"
spec=importlib.util.spec_from_file_location("watch",SCRIPT); watch=importlib.util.module_from_spec(spec); spec.loader.exec_module(watch)

class WatchTests(unittest.TestCase):
    def test_conservative_price_and_relevance(self):
        self.assertEqual(watch.parse_price("Pokemon 151 sealed booster deal $39.99"),3999)
        self.assertTrue(watch.relevant("Pokemon 151 sealed booster deal $39.99"))
        self.assertFalse(watch.relevant("desk lamp $12")); self.assertIsNone(watch.parse_price("save 20 percent"))
    def test_dedupe(self):
        db=sqlite3.connect(":memory:");watch.ensure_schema(db);msg={"id":"123456789012345678","content":"Pokemon 151 sealed deal $39.99","timestamp":"2026-07-20T00:00:00Z"}
        self.assertEqual(watch.store_messages(db,"123456789012345679",[msg]),1);self.assertEqual(watch.store_messages(db,"123456789012345679",[msg]),0)
        self.assertEqual(db.execute("select count(*) from pk_discord_deals").fetchone()[0],1)
        db.close()
    def test_multi_page_drain_advances_without_skipping_and_dedupes(self):
        db=sqlite3.connect(":memory:");watch.ensure_schema(db)
        def msg(i): return {"id":str(i),"content":f"Pokemon sealed deal ${i}.00","timestamp":"2026-07-20T00:00:00Z"}
        pages=[[msg(i) for i in range(1,101)],[msg(100),msg(101),msg(102)]]; after=[]
        def fetch(_token,_channel,cursor): after.append(cursor); return pages.pop(0)
        with patch.object(watch,"fetch_messages",fetch): self.assertEqual(watch.drain_channel(db,"token","123456789012345678",None),102)
        self.assertEqual(after,[None,"100"]);self.assertEqual(db.execute("select count(*) from pk_discord_deals").fetchone()[0],102)
        self.assertEqual(db.execute("select last_message_id from pk_discord_cursors").fetchone()[0],"102");db.close()
    def test_watcher_schema_before_migration_preserves_matching_status_constraint(self):
        db=sqlite3.connect(":memory:");watch.ensure_schema(db)
        migration=(Path(__file__).parents[3]/"db/migrations/0013_discord_deals.sql").read_text();db.executescript(migration)
        with self.assertRaises(sqlite3.IntegrityError): db.execute("insert into pk_discord_deals(channel_id,message_id,product_text,observed_at,matching_status,raw_excerpt) values('1','2','x','2026-01-01','invalid','x')")
        db.close()
    def test_missing_config_is_silent(self):
        old=dict(os.environ)
        try:
            os.environ.clear()
            with tempfile.TemporaryDirectory() as tmp:
                os.environ["HOME"]=tmp;out=io.StringIO();err=io.StringIO()
                with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err): self.assertEqual(watch.main(),0)
                self.assertEqual(out.getvalue(),"");self.assertEqual(err.getvalue(),"")
        finally: os.environ.clear();os.environ.update(old)

if __name__=="__main__": unittest.main()
