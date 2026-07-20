import contextlib, importlib.util, io, os, sqlite3, tempfile, unittest
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
