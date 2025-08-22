import streamlit as st
import requests
import re
import json
import os
from datetime import datetime

class PredictusAPI:
    def __init__(self):
        self.base_url = "https://api.predictus.inf.br"
        self.token = None
        # Usar secrets do Streamlit em vez de hardcoded
        self.username = st.secrets.get("PREDICTUS_USERNAME", "motoristapx.teste")
        self.password = st.secrets.get("PREDICTUS_PASSWORD", "")
    
    def authenticate(self):
        try:
            response = requests.post(f"{self.base_url}/auth", 
                json={"username": self.username, "password": self.password},
                headers={"Content-Type": "application/json", "User-Agent": "streamlit-app/1.0"})
            if response.status_code == 200:
                self.token = response.json().get("accessToken")
                return bool(self.token)
            st.error(f"Erro na autenticação: {response.status_code}")
        except Exception as e:
            st.error(f"Erro na autenticação: {str(e)}")
        return False
    
    def _request(self, endpoint, payload):
        if not self.token and not self.authenticate():
            return None
        
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"}
        
        try:
            response = requests.post(f"{self.base_url}{endpoint}", json=payload, headers=headers)
            if response.status_code == 401 and self.authenticate():
                headers["Authorization"] = f"Bearer {self.token}"
                response = requests.post(f"{self.base_url}{endpoint}", json=payload, headers=headers)
            return response.json() if response.status_code == 200 else None
        except Exception as e:
            st.error(f"Erro na requisição: {str(e)}")
            return None
    
    def buscar_por_nome(self, nome):
        return self._request("/predictus-api/processos/judiciais/buscarPorNomeParte", {"nome": nome.upper()})
    
    def buscar_por_cpf(self, cpf):
        return self._request("/predictus-api/processos/judiciais/buscarPorCPFParte", {"cpf": cpf})
    
    def buscar_por_numero_cnj(self, numero_processo):
        return self._request("/predictus-api/processos/judiciais/buscarPorNumeroCNJ", {"numeroProcessoUnico": numero_processo})

def limpar_texto(texto):
    if not texto: return texto
    subs = {'º': 'o', 'ª': 'a', '–': '-', '—': '-', '"': '"', '"': '"', ''': "'", ''': "'", '…': '...'}
    for k, v in subs.items():
        texto = texto.replace(k, v)
    return texto

def is_cpf(texto):
    cpf = re.sub(r'\D', '', texto)
    return len(cpf) == 11 and cpf != cpf[0] * 11

def formatar_valor(valor):
    if valor:
        try:
            return f"R$ {float(valor):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        except:
            return f"R$ {valor}"
    return "Não informado"

def formatar_data(data_str):
    if data_str:
        try:
            data = datetime.fromisoformat(data_str.replace('Z', '+00:00'))
            return data.strftime('%d/%m/%Y')
        except:
            return data_str
    return "Não informado"

def carregar_historico():
    try:
        if os.path.exists("historico_pesquisas.json"):
            with open("historico_pesquisas.json", "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        st.error(f"Erro ao carregar histórico: {str(e)}")
    return []

def salvar_historico(historico):
    try:
        with open("historico_pesquisas.json", "w", encoding="utf-8") as f:
            json.dump(historico, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        st.error(f"Erro ao salvar histórico: {str(e)}")
        return False

def salvar_detalhes_processo(numero_processo, detalhes):
    try:
        # Trabalhar diretamente com o session_state em vez de recarregar do arquivo
        historico = st.session_state.historico_pesquisas.copy()
        for pesquisa in historico:
            for processo in pesquisa['resultados']:
                if processo.get('numeroProcessoUnico') == numero_processo:
                    if 'detalhes_processos' not in pesquisa:
                        pesquisa['detalhes_processos'] = {}
                    pesquisa['detalhes_processos'][numero_processo] = detalhes
                    
                    # Salvar no arquivo e atualizar session_state apenas se salvar com sucesso
                    if salvar_historico(historico):
                        st.session_state.historico_pesquisas = historico
                        return True
                    return False
        return False
    except Exception as e:
        st.error(f"Erro ao salvar detalhes: {str(e)}")
        return False

def exibir_movimentos(movimentos):
    if not movimentos:
        st.info("Nenhum movimento processual encontrado.")
        return
    
    st.subheader(f"Movimentações Processuais ({len(movimentos)} movimentos)")
    for mov in sorted(movimentos, key=lambda x: x.get('data', ''), reverse=True):
        data_mov = formatar_data(mov.get('data'))
        nome_class = limpar_texto(mov.get('classificacaoCNJ', {}).get('nome', 'N/A'))
        descricao = limpar_texto(mov.get('descricao', ''))
        
        with st.expander(f"{data_mov} - {nome_class}", expanded=False):
            col1, col2 = st.columns(2)
            with col1:
                st.write(f"**Índice:** {mov.get('indice', 'N/A')}")
                st.write(f"**Código CNJ:** {mov.get('classificacaoCNJ', {}).get('codigoCNJ', '')}")
            with col2:
                st.write(f"**Data:** {data_mov}")
                st.write(f"**Classificação:** {nome_class}")
            if descricao:
                st.write("**Descrição:**")
                st.write(descricao)

def exibir_processo(processo, indice):
    numero_processo = processo.get('numeroProcessoUnico', 'N/A')
    key_detalhes = f"detalhes_{numero_processo}"
    tem_detalhes = key_detalhes in st.session_state
    
    if tem_detalhes:
        movimentos_count = len(st.session_state[key_detalhes].get('movimentos', []))
        titulo = f"Processo: {numero_processo} (DETALHES CARREGADOS - {movimentos_count} movimentos)" if movimentos_count else f"Processo: {numero_processo} (DETALHES CARREGADOS)"
    else:
        titulo = f"Processo: {numero_processo}"
    
    with st.expander(titulo, expanded=False):
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Informações do Tribunal")
            st.write(f"**Tribunal:** {limpar_texto(processo.get('tribunal', 'N/A'))}")
            st.write(f"**UF:** {processo.get('uf', 'N/A')}")
            st.write(f"**Órgão:** {limpar_texto(processo.get('orgaoJulgador', 'N/A'))}")
            st.write(f"**Grau:** {processo.get('grauProcesso', 'N/A')}")
        
        with col2:
            st.subheader("Datas")
            st.write(f"**Distribuição:** {formatar_data(processo.get('dataDistribuicao'))}")
            st.write(f"**Autuação:** {formatar_data(processo.get('dataAutuacao'))}")
        
        classe = processo.get('classeProcessual', {})
        if classe:
            st.write(f"**Classe:** {limpar_texto(classe.get('nome', 'N/A'))}")
        
        assuntos = processo.get('assuntosCNJ', [])
        if assuntos:
            st.write("**Assuntos:**")
            for assunto in assuntos:
                principal = "Principal" if assunto.get('ePrincipal') else "Secundário"
                titulo = limpar_texto(assunto.get('titulo', 'N/A'))
                st.write(f"  {principal}: {titulo}")
        
        valor_causa = processo.get('valorCausa', {})
        if valor_causa:
            st.write(f"**Valor da Causa:** {formatar_valor(valor_causa.get('valor'))}")
        
        st.subheader("Partes")
        for parte in processo.get('partes', []):
            tipo = limpar_texto(parte.get('tipo', 'N/A'))
            nome = limpar_texto(parte.get('nome', 'N/A'))
            doc = parte.get('cpf') or parte.get('cnpj', '')
            doc_info = f" (CPF/CNPJ: {doc})" if doc else ""
            st.write(f"**{tipo}:** {nome}{doc_info}")
            
            for adv in parte.get('advogados', []):
                nome_adv = limpar_texto(adv.get('nome', 'N/A'))
                oab = adv.get('oab', {})
                oab_info = f"OAB/{oab.get('uf')}: {oab.get('numero')}" if oab else ""
                st.write(f"  {nome_adv} {oab_info}")
        
        url_processo = processo.get('urlProcesso')
        if url_processo:
            st.write(f"[Acessar no tribunal]({url_processo})")
        
        movimentos = processo.get('movimentos', [])
        if tem_detalhes:
            movimentos_detalhados = st.session_state[key_detalhes].get('movimentos', [])
            if len(movimentos_detalhados) > len(movimentos):
                movimentos = movimentos_detalhados
        
        if movimentos:
            exibir_movimentos(movimentos)
        else:
            if st.button("Buscar Detalhes", key=f"btn_detalhes_{numero_processo}_{indice}"):
                api = st.session_state.get('api') or PredictusAPI()
                st.session_state.api = api
                
                with st.spinner("Buscando detalhes..."):
                    detalhes = api.buscar_por_numero_cnj(numero_processo)
                    
                    if detalhes and len(detalhes) > 0:
                        processo_detalhado = detalhes[0]
                        st.session_state[key_detalhes] = processo_detalhado
                        
                        # Salvar detalhes primeiro
                        salvar_detalhes_processo(numero_processo, processo_detalhado)
                        
                        movimentos = processo_detalhado.get('movimentos', [])
                        if movimentos:
                            st.success(f"✅ Encontrados {len(movimentos)} movimentos! 💾 Detalhes salvos.")
                            exibir_movimentos(movimentos)
                        else:
                            st.success("✅ Processo consultado e salvo! Sem movimentos adicionais.")
                        
                        # Criar um estado temporário para forçar re-renderização apenas uma vez
                        if f"atualizar_{numero_processo}" not in st.session_state:
                            st.session_state[f"atualizar_{numero_processo}"] = True
                            st.rerun()
                    else:
                        st.warning("Não foi possível obter detalhes do processo.")

def main():
    st.set_page_config(page_title="Consulta Processos", page_icon="⚖️", layout="wide")
    
    st.title("Consulta de Processos Judiciais")
    st.markdown("---")
    
    if 'resultados' not in st.session_state:
        st.session_state.resultados = None
    if 'historico_pesquisas' not in st.session_state:
        st.session_state.historico_pesquisas = carregar_historico()
    
    st.subheader("Buscar Processos")
    
    # Campos alinhados na mesma linha com proporções ajustadas
    col1, col2 = st.columns([3, 1])
    
    with col1:
        entrada = st.text_input("Nome completo ou CPF:", placeholder="Ex: João Silva ou 123.456.789-10")
    
    with col2:
    
        if st.button("🔍 Nova Busca", type="primary", use_container_width=True):
            if not entrada.strip():
                st.warning("Digite um nome ou CPF para pesquisar.")
                return
            
            api = st.session_state.get('api') or PredictusAPI()
            st.session_state.api = api
            
            with st.spinner("Buscando processos..."):
                if is_cpf(entrada):
                    cpf = re.sub(r'\D', '', entrada)
                    st.info(f"Buscando por CPF: {cpf}")
                    resultados = api.buscar_por_cpf(cpf)
                    tipo_busca, termo_exibicao = "CPF", cpf
                else:
                    st.info(f"Buscando por nome: {entrada}")
                    resultados = api.buscar_por_nome(entrada)
                    tipo_busca, termo_exibicao = "Nome", entrada
            
            st.session_state.resultados = resultados
            
            if resultados is not None:
                pesquisa_info = {
                    'termo': termo_exibicao,
                    'tipo': tipo_busca,
                    'data_hora': datetime.now().strftime('%d/%m/%Y %H:%M'),
                    'total_processos': len(resultados),
                    'resultados': resultados
                }
                
                st.session_state.historico_pesquisas.insert(0, pesquisa_info)
                if len(st.session_state.historico_pesquisas) > 50:
                    st.session_state.historico_pesquisas = st.session_state.historico_pesquisas[:50]
                
                if salvar_historico(st.session_state.historico_pesquisas):
                    st.success("✅ Pesquisa salva no histórico permanente!")
    
    if st.session_state.resultados is not None:
        resultados = st.session_state.resultados
        
        if len(resultados) == 0:
            st.warning("Nenhum processo encontrado.")
        else:
            st.success(f"Encontrados {len(resultados)} processos")
            
            tribunais = {}
            valor_total = 0
            
            for proc in resultados:
                tribunal = proc.get('tribunal', 'N/A')
                tribunais[tribunal] = tribunais.get(tribunal, 0) + 1
                valor = proc.get('valorCausa', {}).get('valor', 0)
                if valor:
                    try:
                        valor_total += float(valor)
                    except:
                        pass
            
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Total", len(resultados))
            with col2:
                tribunal_top = max(tribunais, key=tribunais.get) if tribunais else "N/A"
                st.metric("Tribunal Principal", tribunal_top)
            with col3:
                st.metric("Valor Total", formatar_valor(valor_total))
            
            st.markdown("---")
        
        st.subheader("📋 Processos Encontrados")
        for i, processo in enumerate(resultados):
            exibir_processo(processo, i)
    
    with st.sidebar:
        st.header("Informações")
        st.markdown("""
        **Como usar:**
        1. Digite nome completo ou CPF
        2. Clique em "Buscar"
        3. Navegue pelos processos
        4. Use "Buscar Detalhes" para movimentações
        
        **Recursos:**
        - 💾 Histórico salvo automaticamente
        - 🔄 Pesquisas + detalhes persistem após reload
        - 🔍 Busca por nome ou CPF
        - 📋 Detalhes completos dos processos
        - ⚖️ Movimentações processuais salvas
        """)
        
        st.markdown("---")
        st.header("Histórico de Pesquisas")
        
        if st.session_state.historico_pesquisas:
            st.write(f"**{len(st.session_state.historico_pesquisas)} pesquisas salvas**")
            st.caption("💾 Histórico salvo automaticamente")
            
            for i, pesquisa in enumerate(st.session_state.historico_pesquisas):
                detalhes_count = len(pesquisa.get('detalhes_processos', {}))
                detalhes_info = f" + {detalhes_count} detalhados" if detalhes_count > 0 else ""
                
                with st.expander(f"{pesquisa['tipo']}: {pesquisa['termo'][:20]}{'...' if len(pesquisa['termo']) > 20 else ''}", expanded=False):
                    st.write(f"**Tipo:** {pesquisa['tipo']}")
                    st.write(f"**Termo:** {pesquisa['termo']}")
                    st.write(f"**Data/Hora:** {pesquisa['data_hora']}")
                    st.write(f"**Processos:** {pesquisa['total_processos']}{detalhes_info}")
                    
                    if detalhes_count > 0:
                        st.write(f"**💾 Detalhes salvos:** {detalhes_count} processos")
                    
                    # Botões lado a lado
                    col1, col2 = st.columns(2)
                    
                    with col1:
                        if st.button("📂 Abrir", key=f"recarregar_{i}"):
                            # Limpar resultados atuais para evitar duplicação
                            st.session_state.resultados = None
                            
                            # Recarregar resultados da pesquisa
                            st.session_state.resultados = pesquisa['resultados']
                            
                            # Carregar detalhes salvos
                            detalhes_processos = pesquisa.get('detalhes_processos', {})
                            for numero_processo, detalhes in detalhes_processos.items():
                                st.session_state[f"detalhes_{numero_processo}"] = detalhes
                            
                            detalhes_count = len(detalhes_processos)
                            if detalhes_count > 0:
                                st.success(f"Pesquisa aberta: {pesquisa['total_processos']} processos + {detalhes_count} com detalhes salvos")
                            else:
                                st.success(f"Pesquisa aberta: {pesquisa['total_processos']} processos")
                            st.rerun()
                    
                    with col2:
                        if st.button("🗑️ Excluir", key=f"excluir_{i}"):
                            # Remover a pesquisa do histórico
                            st.session_state.historico_pesquisas.pop(i)
                            
                            # Salvar histórico atualizado no arquivo
                            if salvar_historico(st.session_state.historico_pesquisas):
                                st.success(f"✅ Pesquisa '{pesquisa['termo']}' excluída do histórico!")
                            else:
                                st.error("❌ Erro ao excluir pesquisa do arquivo.")
                            
                            st.rerun()
        else:
            st.info("Nenhuma pesquisa salva ainda.")
            st.caption("💾 Pesquisas e detalhes são salvos automaticamente em 'historico_pesquisas.json'")

if __name__ == "__main__":
    main()