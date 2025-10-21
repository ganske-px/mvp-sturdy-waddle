"""
File Storage Utilities
Handle JSON file operations for search history
"""
import json
import streamlit as st
from typing import List, Dict
from config.settings import HIST_FILE


class FileStorage:
    """Handles file-based data persistence"""

    @staticmethod
    def load_search_history() -> List[Dict]:
        """Load search history from file"""
        try:
            if HIST_FILE.exists():
                with open(HIST_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            st.error(f"Error loading history: {e}")

        return []

    @staticmethod
    def save_search_history(history: List[Dict]) -> bool:
        """Save search history to file"""
        try:
            with open(HIST_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            st.error(f"Error saving history: {e}")
            return False

    @staticmethod
    def save_process_details(process_number: str, details: Dict, history: List[Dict]) -> bool:
        """Save process details to history"""
        try:
            for search in history:
                for process in search.get('resultados', []):
                    if process.get('numeroProcessoUnico') == process_number:
                        if 'detalhes_processos' not in search:
                            search['detalhes_processos'] = {}
                        search['detalhes_processos'][process_number] = details

                        if FileStorage.save_search_history(history):
                            return True
                        return False
            return False

        except Exception as e:
            st.error(f"Error saving process details: {e}")
            return False
