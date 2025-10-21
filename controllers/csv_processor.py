"""
CSV Processor Controller
Handles CSV file processing and CPF extraction
"""
import pandas as pd
import streamlit as st
from typing import List, Tuple
from utils.data_helpers import CPFValidator


class CSVProcessor:
    """Handles CSV file processing and CPF extraction"""

    @staticmethod
    def extract_cpfs_from_dataframe(df: pd.DataFrame) -> List[str]:
        """Extract all CPFs from DataFrame"""
        all_cpfs = set()

        for column in df.columns:
            for value in df[column]:
                cpfs = CPFValidator.extract_cpfs_from_text(str(value))
                all_cpfs.update(cpfs)

        return sorted(list(all_cpfs))

    @staticmethod
    def process_csv_file(uploaded_file) -> Tuple[List[str], pd.DataFrame]:
        """Process uploaded CSV and extract unique CPFs"""
        try:
            # Read CSV with various encodings
            try:
                df = pd.read_csv(uploaded_file, encoding='utf-8')
            except UnicodeDecodeError:
                uploaded_file.seek(0)
                df = pd.read_csv(uploaded_file, encoding='latin-1')

            # Extract CPFs from all columns
            unique_cpfs = CSVProcessor.extract_cpfs_from_dataframe(df)
            return unique_cpfs, df

        except Exception as e:
            st.error(f"Error processing CSV: {e}")
            return [], pd.DataFrame()

    @staticmethod
    def validate_csv_file(uploaded_file) -> Tuple[bool, str]:
        """Validate uploaded file"""
        if uploaded_file is None:
            return False, "No file uploaded"

        # Check file extension
        if not uploaded_file.name.endswith('.csv'):
            return False, "File must be a CSV file"

        # Check file size (max 10MB)
        file_size = uploaded_file.size
        if file_size > 10 * 1024 * 1024:
            return False, "File size exceeds 10MB limit"

        return True, "File is valid"
