import os
import sys

# Fake credentials so no test can ever reach a real AWS account.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-south-1")
os.environ.setdefault("FINOPS_SECRET", "test-secret")
os.environ.setdefault("COOKIE_SECURE", "false")
sys.path.insert(0, os.path.dirname(__file__))
