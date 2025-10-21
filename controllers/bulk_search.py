"""
Controlador de Pesquisa em Lote
Gerencia pesquisas em lote de CPFs e agregação de resultados
"""
import pandas as pd
from typing import Dict, List, Callable
from models.predictus_api import PredictusAPI
from utils.data_helpers import DataFormatter


class BulkSearchManager:
    """Gerencia pesquisas em lote de CPFs e agregação de resultados"""

    def __init__(self, api: PredictusAPI):
        self.api = api
        self.results = {
            'nada_consta': [],
            'found_processes': {},
            'errors': []
        }

    def search_cpf_list(self, cpf_list: List[str], progress_callback: Callable = None) -> Dict:
        """Pesquisa múltiplos CPFs e categoriza resultados"""
        total = len(cpf_list)

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

    def get_summary(self) -> Dict[str, int]:
        """Obtém estatísticas resumidas da pesquisa em lote"""
        return {
            'total_searched': len(self.results['nada_consta']) + len(self.results['found_processes']) + len(self.results['errors']),
            'nada_consta': len(self.results['nada_consta']),
            'with_processes': len(self.results['found_processes']),
            'total_processes': sum(len(procs) for procs in self.results['found_processes'].values()),
            'errors': len(self.results['errors'])
        }

    def export_results_to_csv(self) -> str:
        """Exporta resultados para formato CSV"""
        rows = []

        # Nada consta
        for cpf in self.results['nada_consta']:
            rows.append({
                'CPF': DataFormatter.format_cpf(cpf),
                'Status': 'Nada Consta',
                'Total Processos': 0,
                'Detalhes': 'Nenhum processo encontrado'
            })

        # Com processos
        for cpf, processes in self.results['found_processes'].items():
            process_details = []
            for proc in processes:
                num = proc.get('numeroProcessoUnico', 'N/A')
                tribunal = proc.get('tribunal', 'N/A')
                process_details.append(f"{num} ({tribunal})")

            rows.append({
                'CPF': DataFormatter.format_cpf(cpf),
                'Status': 'Processos Encontrados',
                'Total Processos': len(processes),
                'Detalhes': '; '.join(process_details)
            })

        # Erros
        for error in self.results['errors']:
            rows.append({
                'CPF': DataFormatter.format_cpf(error['cpf']),
                'Status': 'Erro',
                'Total Processos': 0,
                'Detalhes': error['error']
            })

        df = pd.DataFrame(rows)
        return df.to_csv(index=False)
