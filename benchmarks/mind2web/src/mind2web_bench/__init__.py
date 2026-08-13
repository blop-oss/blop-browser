"""Download and normalize Mind2Web tasks for Blop Browser agents."""

from .download import REPO_ID, data_dir, download_test, download_train
from .prepare import prepare

__all__ = ["REPO_ID", "data_dir", "download_test", "download_train", "prepare"]
