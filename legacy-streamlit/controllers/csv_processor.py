"""
Controlador de Processamento CSV
Gerencia processamento de arquivos CSV e extração de CPFs e CNPJs
"""
import pandas as pd
import streamlit as st
from typing import List, Tuple
from utils.data_helpers import CPFValidator, CNPJValidator


class CSVProcessor:
    """Gerencia processamento de arquivos CSV e extração de CPFs e CNPJs"""

    @staticmethod
    def extract_cpfs_from_dataframe(df: pd.DataFrame) -> List[str]:
        """Extrai todos os CPFs do DataFrame"""
        all_cpfs = set()

        for column in df.columns:
            for value in df[column]:
                cpfs = CPFValidator.extract_cpfs_from_text(str(value))
                all_cpfs.update(cpfs)

        return sorted(list(all_cpfs))

    @staticmethod
    def extract_cnpjs_from_dataframe(df: pd.DataFrame) -> List[str]:
        """Extrai todos os CNPJs do DataFrame"""
        all_cnpjs = set()

        for column in df.columns:
            for value in df[column]:
                cnpjs = CNPJValidator.extract_cnpjs_from_text(str(value))
                all_cnpjs.update(cnpjs)

        return sorted(list(all_cnpjs))

    @staticmethod
    def process_csv_file(uploaded_file) -> Tuple[List[str], List[str], pd.DataFrame]:
        """Processa CSV enviado e extrai CPFs e CNPJs únicos"""
        try:
            # Ler CSV com várias codificações
            try:
                df = pd.read_csv(uploaded_file, encoding='utf-8')
            except UnicodeDecodeError:
                uploaded_file.seek(0)
                df = pd.read_csv(uploaded_file, encoding='latin-1')

            # Extrair CPFs e CNPJs de todas as colunas
            unique_cpfs = CSVProcessor.extract_cpfs_from_dataframe(df)
            unique_cnpjs = CSVProcessor.extract_cnpjs_from_dataframe(df)
            return unique_cpfs, unique_cnpjs, df

        except Exception as e:
            st.error(f"Erro ao processar CSV: {e}")
            return [], [], pd.DataFrame()

    @staticmethod
    def validate_csv_file(uploaded_file) -> Tuple[bool, str]:
        """Valida arquivo enviado"""
        if uploaded_file is None:
            return False, "Nenhum arquivo enviado"

        # Verificar extensão do arquivo
        if not uploaded_file.name.endswith('.csv'):
            return False, "Arquivo deve ser um CSV"

        # Verificar tamanho do arquivo (máx 10MB)
        file_size = uploaded_file.size
        if file_size > 10 * 1024 * 1024:
            return False, "Tamanho do arquivo excede o limite de 10MB"

        return True, "Arquivo válido"
