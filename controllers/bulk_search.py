"""
Controlador de Pesquisa em Lote
Gerencia pesquisas em lote de CPFs, CNPJs e agregação de resultados
"""
import pandas as pd
from typing import Dict, List, Callable
from models.predictus_api import PredictusAPI
from utils.data_helpers import DataFormatter, CNPJValidator


class BulkSearchManager:
    """Gerencia pesquisas em lote de CPFs, CNPJs e agregação de resultados"""

    def __init__(self, api: PredictusAPI):
        self.api = api
        self.results = {
            'nada_consta': [],
            'nada_consta_cnpj': [],
            'found_processes': {},
            'found_processes_cnpj': {},
            'errors': [],
            'errors_cnpj': []
        }
        self._cpfs_searched = 0
        self._cnpjs_searched = 0

    def search_cpf_list(self, cpf_list: List[str], progress_callback: Callable = None) -> Dict:
        """Pesquisa múltiplos CPFs e categoriza resultados"""
        total = len(cpf_list)
        self._cpfs_searched = total

        for idx, cpf in enumerate(cpf_list):
            # Atualizar progresso
            if progress_callback:
                progress_callback(idx + 1, total, cpf)

            try:
                # Pesquisar por CPF
                results = self.api.search_by_cpf(cpf)

                if results is None:
                    self.results['errors'].append({
                        'cpf': cpf,
                        'error': 'Falha na requisição da API'
                    })
                elif len(results) == 0:
                    # Nada consta
                    self.results['nada_consta'].append(cpf)
                else:
                    # Processos encontrados
                    self.results['found_processes'][cpf] = results

            except Exception as e:
                self.results['errors'].append({
                    'cpf': cpf,
                    'error': str(e)
                })

        return self.results

    def search_cnpj_list(self, cnpj_list: List[str], progress_callback: Callable = None) -> Dict:
        """Pesquisa múltiplos CNPJs e categoriza resultados"""
        total = len(cnpj_list)
        self._cnpjs_searched = total

        for idx, cnpj in enumerate(cnpj_list):
            # Atualizar progresso
            if progress_callback:
                progress_callback(idx + 1, total, cnpj)

            try:
                # Pesquisar por CNPJ
                results = self.api.search_by_cnpj(cnpj)

                if results is None:
                    self.results['errors_cnpj'].append({
                        'cnpj': cnpj,
                        'error': 'Falha na requisição da API'
                    })
                elif len(results) == 0:
                    # Nada consta
                    self.results['nada_consta_cnpj'].append(cnpj)
                else:
                    # Processos encontrados
                    self.results['found_processes_cnpj'][cnpj] = results

            except Exception as e:
                self.results['errors_cnpj'].append({
                    'cnpj': cnpj,
                    'error': str(e)
                })

        return self.results

    def get_summary(self) -> Dict[str, int]:
        """Obtém estatísticas resumidas da pesquisa em lote"""
        cpf_total = len(self.results['nada_consta']) + len(self.results['found_processes']) + len(self.results['errors'])
        cnpj_total = len(self.results['nada_consta_cnpj']) + len(self.results['found_processes_cnpj']) + len(self.results['errors_cnpj'])

        return {
            'total_searched': cpf_total + cnpj_total,
            'cpfs_searched': self._cpfs_searched,
            'cnpjs_searched': self._cnpjs_searched,
            'nada_consta': len(self.results['nada_consta']),
            'nada_consta_cnpj': len(self.results['nada_consta_cnpj']),
            'with_processes': len(self.results['found_processes']),
            'with_processes_cnpj': len(self.results['found_processes_cnpj']),
            'total_processes': sum(len(procs) for procs in self.results['found_processes'].values()) + sum(len(procs) for procs in self.results['found_processes_cnpj'].values()),
            'errors': len(self.results['errors']),
            'errors_cnpj': len(self.results['errors_cnpj'])
        }

    def export_results_to_csv(self) -> str:
        """Exporta resultados para formato CSV"""
        rows = []

        # CPFs - Nada consta
        for cpf in self.results['nada_consta']:
            rows.append({
                'Tipo': 'CPF',
                'Documento': DataFormatter.format_cpf(cpf),
                'Status': 'Nada Consta',
                'Total Processos': 0,
                'Detalhes': 'Nenhum processo encontrado'
            })

        # CPFs - Com processos
        for cpf, processes in self.results['found_processes'].items():
            process_details = []
            for proc in processes:
                num = proc.get('numeroProcessoUnico', 'N/A')
                tribunal = proc.get('tribunal', 'N/A')
                process_details.append(f"{num} ({tribunal})")

            rows.append({
                'Tipo': 'CPF',
                'Documento': DataFormatter.format_cpf(cpf),
                'Status': 'Processos Encontrados',
                'Total Processos': len(processes),
                'Detalhes': '; '.join(process_details)
            })

        # CPFs - Erros
        for error in self.results['errors']:
            rows.append({
                'Tipo': 'CPF',
                'Documento': DataFormatter.format_cpf(error['cpf']),
                'Status': 'Erro',
                'Total Processos': 0,
                'Detalhes': error['error']
            })

        # CNPJs - Nada consta
        for cnpj in self.results['nada_consta_cnpj']:
            rows.append({
                'Tipo': 'CNPJ',
                'Documento': CNPJValidator.format_cnpj(cnpj),
                'Status': 'Nada Consta',
                'Total Processos': 0,
                'Detalhes': 'Nenhum processo encontrado'
            })

        # CNPJs - Com processos
        for cnpj, processes in self.results['found_processes_cnpj'].items():
            process_details = []
            for proc in processes:
                num = proc.get('numeroProcessoUnico', 'N/A')
                tribunal = proc.get('tribunal', 'N/A')
                process_details.append(f"{num} ({tribunal})")

            rows.append({
                'Tipo': 'CNPJ',
                'Documento': CNPJValidator.format_cnpj(cnpj),
                'Status': 'Processos Encontrados',
                'Total Processos': len(processes),
                'Detalhes': '; '.join(process_details)
            })

        # CNPJs - Erros
        for error in self.results['errors_cnpj']:
            rows.append({
                'Tipo': 'CNPJ',
                'Documento': CNPJValidator.format_cnpj(error['cnpj']),
                'Status': 'Erro',
                'Total Processos': 0,
                'Detalhes': error['error']
            })

        df = pd.DataFrame(rows)
        return df.to_csv(index=False)
