"""
Bulk Search Controller
Handles bulk CPF searches and result aggregation
"""
import pandas as pd
from typing import Dict, List, Callable
from models.predictus_api import PredictusAPI
from models.analytics import PosthogAPI
from models.risk_assessment import RiskAssessor
from utils.data_helpers import DataFormatter


class BulkSearchManager:
    """Handles bulk CPF searches and result aggregation"""

    def __init__(self, api: PredictusAPI, posthog: PosthogAPI):
        self.api = api
        self.posthog = posthog
        self.risk_assessor = RiskAssessor()
        self.results = {
            'nada_consta': [],
            'found_processes': {},
            'errors': [],
            'risk_assessments': {}  # CPF -> risk_data
        }

    def search_cpf_list(self, cpf_list: List[str], progress_callback: Callable = None) -> Dict:
        """Search multiple CPFs and categorize results"""
        total = len(cpf_list)

        for idx, cpf in enumerate(cpf_list):
            # Update progress
            if progress_callback:
                progress_callback(idx + 1, total, cpf)

            try:
                # Search by CPF
                results = self.api.search_by_cpf(cpf)

                if results is None:
                    self.results['errors'].append({
                        'cpf': cpf,
                        'error': 'API request failed'
                    })
                elif len(results) == 0:
                    # Nada consta - still calculate risk (will be low/clean)
                    self.results['nada_consta'].append(cpf)
                    risk_data = self.risk_assessor.assess_risk([], {"search_term": cpf})
                    self.results['risk_assessments'][cpf] = risk_data
                else:
                    # Found processes - calculate risk
                    self.results['found_processes'][cpf] = results
                    risk_data = self.risk_assessor.assess_risk(results, {"search_term": cpf})
                    self.results['risk_assessments'][cpf] = risk_data

                # Track search in analytics
                self.posthog.track_search(cpf, is_new=True)

            except Exception as e:
                self.results['errors'].append({
                    'cpf': cpf,
                    'error': str(e)
                })

        return self.results

    def get_summary(self) -> Dict[str, int]:
        """Get summary statistics of bulk search"""
        # Risk level counts
        risk_counts = {'low': 0, 'medium': 0, 'high': 0, 'critical': 0}
        for risk_data in self.results['risk_assessments'].values():
            level = risk_data.get('level', 'low')
            risk_counts[level] = risk_counts.get(level, 0) + 1

        return {
            'total_searched': len(self.results['nada_consta']) + len(self.results['found_processes']) + len(self.results['errors']),
            'nada_consta': len(self.results['nada_consta']),
            'with_processes': len(self.results['found_processes']),
            'total_processes': sum(len(procs) for procs in self.results['found_processes'].values()),
            'errors': len(self.results['errors']),
            'low_risk': risk_counts['low'],
            'medium_risk': risk_counts['medium'],
            'high_risk': risk_counts['high'],
            'critical_risk': risk_counts['critical']
        }

    def export_results_to_csv(self) -> str:
        """Export results to CSV format with risk assessment"""
        rows = []

        # Nada consta
        for cpf in self.results['nada_consta']:
            risk_data = self.results['risk_assessments'].get(cpf, {})
            rows.append({
                'CPF': DataFormatter.format_cpf(cpf),
                'Status': 'Nada Consta',
                'Total Processos': 0,
                'Risk Score': risk_data.get('score', 0),
                'Risk Level': risk_data.get('level_label', 'Low Risk'),
                'Risk Summary': risk_data.get('summary', 'Clean record'),
                'LLM Recommendation': risk_data.get('llm_analysis', {}).get('recommendation', 'Approved'),
                'Detalhes': 'Nenhum processo encontrado'
            })

        # With processes
        for cpf, processes in self.results['found_processes'].items():
            risk_data = self.results['risk_assessments'].get(cpf, {})
            process_details = []
            for proc in processes:
                num = proc.get('numeroProcessoUnico', 'N/A')
                tribunal = proc.get('tribunal', 'N/A')
                process_details.append(f"{num} ({tribunal})")

            # Extract red flags if available
            red_flags = risk_data.get('llm_analysis', {}).get('red_flags', [])
            red_flags_str = '; '.join(red_flags) if red_flags else 'None identified'

            rows.append({
                'CPF': DataFormatter.format_cpf(cpf),
                'Status': 'Processos Encontrados',
                'Total Processos': len(processes),
                'Risk Score': risk_data.get('score', 0),
                'Risk Level': risk_data.get('level_label', 'Unknown'),
                'Risk Summary': risk_data.get('summary', ''),
                'LLM Recommendation': risk_data.get('llm_analysis', {}).get('recommendation', 'Review required'),
                'Red Flags': red_flags_str,
                'Detalhes': '; '.join(process_details)
            })

        # Errors
        for error in self.results['errors']:
            rows.append({
                'CPF': DataFormatter.format_cpf(error['cpf']),
                'Status': 'Erro',
                'Total Processos': 0,
                'Risk Score': 'N/A',
                'Risk Level': 'N/A',
                'Risk Summary': 'Error during search',
                'LLM Recommendation': 'Manual verification required',
                'Red Flags': '',
                'Detalhes': error['error']
            })

        df = pd.DataFrame(rows)
        return df.to_csv(index=False)
