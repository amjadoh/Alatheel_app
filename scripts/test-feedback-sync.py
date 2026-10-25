import base64
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("sync_feedback",Path(__file__).with_name("sync-feedback.py"))
sync=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class ExportTests(unittest.TestCase):
    def fixture(self):
        content=b"Private isolated fixture - never production data"
        note={"id":"feedback_isolated","text":"ملاحظة عربية $(do-not-execute)","version":"1.10.1","createdByName":"مدير تجريبي","createdAt":"2026-10-25T12:00:00Z","files":[{"index":0,"name":"فحص.txt","extension":"txt","size":len(content),"sha256":hashlib.sha256(content).hexdigest()}]}
        files,issues,acks={},[],[]
        def bridge(action,**data):
            if action=="file":return {"base64":base64.b64encode(content).decode()}
            if action=="complete":acks.append(data);return {"ok":True}
            raise AssertionError(action)
        def github(path,method="GET",data=None):
            if path.startswith("/contents/"):
                key=path.split("?")[0]
                if method=="PUT":
                    self.assertEqual(data["branch"],"app-feedback")
                    self.assertNotIn(key,files)
                    files[key]=base64.b64decode(data["content"]);return {"ok":True}
                if key in files:return {"sha":sync.git_blob_sha(files[key])}
                raise sync.urllib.error.HTTPError(path,404,"missing",None,None)
            if path=="/issues" and method=="POST":
                issue={**data,"number":1,"html_url":"https://github.com/amjadoh/Alatheel_app/issues/1"};issues.append(issue);return issue
            if path.startswith("/issues?"):return issues
            raise AssertionError(path)
        return note,files,issues,acks,bridge,github

    def test_retry_adopts_exact_files_and_issue_without_duplicate_or_overwrite(self):
        note,files,issues,acks,bridge,github=self.fixture()
        with patch.object(sync,"bridge",bridge),patch.object(sync,"github",github):
            self.assertEqual(sync.export_note(note),1)
            self.assertEqual(sync.export_note(note),1)
        self.assertEqual(len(files),2)
        self.assertEqual(len(issues),1)
        self.assertEqual(len(acks),2)
        self.assertIn("$(do-not-execute)",issues[0]["body"])
        self.assertIn("/blob/app-feedback/reports/feedback_isolated/file_0.txt",issues[0]["body"])

    def test_mismatched_bytes_and_existing_content_stop_before_issue_creation(self):
        note,files,issues,acks,bridge,github=self.fixture()
        with patch.object(sync,"bridge",lambda *a,**k:{"base64":base64.b64encode(b"wrong").decode()}),patch.object(sync,"github",github):
            with self.assertRaises(ValueError):sync.export_note(note)
        self.assertEqual(issues,[]);self.assertEqual(files,{})
        files["/contents/reports/feedback_isolated/file_0.txt"]=b"not the expected file"
        with patch.object(sync,"bridge",bridge),patch.object(sync,"github",github):
            with self.assertRaises(ValueError):sync.export_note(note)
        self.assertEqual(issues,[])

    def test_ambiguous_post_is_reconciled_by_listing_before_any_second_post(self):
        note,files,issues,acks,bridge,github=self.fixture()
        failed=False
        def ambiguous(path,method="GET",data=None):
            nonlocal failed
            result=github(path,method,data)
            if path=="/issues" and method=="POST" and not failed:
                failed=True;raise TimeoutError("acknowledgement lost")
            return result
        with patch.object(sync,"bridge",bridge),patch.object(sync,"github",ambiguous):
            with self.assertRaises(TimeoutError):sync.export_note(note)
            self.assertEqual(sync.export_note(note),1)
        self.assertEqual(len(issues),1);self.assertEqual(len(acks),1)

    def test_large_unreconciled_history_never_guesses_that_issue_is_absent(self):
        with patch.object(sync,"github",lambda *a,**k:[{"body":"other"}]*100):
            with self.assertRaises(ValueError):sync.existing_issue("missing-marker")

if __name__=="__main__":unittest.main()
