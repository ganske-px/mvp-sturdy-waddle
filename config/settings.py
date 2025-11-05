"""
Application Configuration
Centralized configuration management
"""
import os
from pathlib import Path

# Paths
HIST_PATH = Path(os.getenv("STREAMLIT_HOME", ".")) / "data"
HIST_PATH.mkdir(parents=True, exist_ok=True)
HIST_FILE = HIST_PATH / "historico_pesquisas.json"

# Constants
MAX_HISTORY_ITEMS = 50
REQUEST_TIMEOUT = 30

# API Configuration
PREDICTUS_BASE_URL = "https://api.predictus.com.br"

# File Upload Limits
MAX_FILE_SIZE_MB = 10
ALLOWED_FILE_TYPES = ['csv']
