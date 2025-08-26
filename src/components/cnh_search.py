import streamlit as st
import pandas as pd
from datetime import datetime
from src.services.api_combate_fraude import CombateFraudeAPI
from src.components.history import salvar_pesquisa_cnh

def extract_person_info(data):
    info = {}
    
    if 'regularidadeCpf' in data:
        reg = data['regularidadeCpf']
        info['nome'] = reg.get('nome', '')
        info['cpf'] = reg.get('cpf', '')
        info['nascimento'] = reg.get('dataNascimento', '')
        info['idade'] = reg.get('idade', '')
        info['status_cpf'] = reg.get('situacaoCadastral', '')
    elif 'pfCpfData' in data.get('sections', {}):
        pf = data['sections']['pfCpfData']['data']
        info['nome'] = pf.get('name', '')
        info['cpf'] = pf.get('taxIdNumber', '')
        info['nascimento'] = pf.get('birthDate', '')
        info['status_cpf'] = pf.get('taxIdStatus', '')
        if info['nascimento']:
            try:
                birth_date = datetime.strptime(info['nascimento'], '%d/%m/%Y')
                age = (datetime.now() - birth_date).days // 365
                info['idade'] = age
            except:
                info['idade'] = 'N/A'
    elif 'attributes' in data:
        attr = data['attributes']
        info['nome'] = attr.get('name', '')
        info['cpf'] = attr.get('cpf', '')
        info['nascimento'] = attr.get('birthDate', '')
        if info['nascimento']:
            try:
                birth_date = datetime.strptime(info['nascimento'], '%Y-%m-%d')
                age = (datetime.now() - birth_date).days // 365
                info['idade'] = age
            except:
                info['idade'] = 'N/A'
        info['status_cpf'] = 'N/A'
    
    return info

def extract_cnh_info(data):
    cnh_info = {}
    
    if 'motoristasCNHcompleto' in data and 'cnh' in data['motoristasCNHcompleto']:
        cnh = data['motoristasCNHcompleto']['cnh']
        cnh_info['numero'] = cnh.get('numero', '')
        cnh_info['categoria'] = cnh.get('categoria', '')
        cnh_info['validade'] = cnh.get('dataExpiracao', '')
        cnh_info['status'] = 'EMITIDA'
    elif 'driverViolations' in data.get('sections', {}):
        driver = data['sections']['driverViolations']['data']
        cnh_info['categoria'] = driver.get('cnhCategory', '')
        cnh_info['validade'] = driver.get('cnhExpirationDate', '')
        cnh_info['status'] = 'CONFIRMADA'
    elif 'denatranDriverViolations' in data.get('sections', {}):
        driver = data['sections']['denatranDriverViolations']['data']['driver']
        cnh_info['categoria'] = driver.get('cnhCategory', '')
        cnh_info['validade'] = driver.get('cnhExpirationDate', '')
        cnh_info['status'] = driver.get('cnhStatus', '')
    
    return cnh_info

def extract_impediments(data):
    impediments = []
    
    if 'driverViolations' in data.get('sections', {}):
        driver_data = data['sections']['driverViolations']['data']
        
        if driver_data.get('cnhImpediment') == 'CONSTA IMPEDIMENTO':
            impediments.append({
                'tipo': 'Impedimento Geral',
                'descricao': 'CONSTA IMPEDIMENTO',
                'status': 'ATIVO'
            })
        
        if 'blocks' in driver_data:
            for block in driver_data['blocks']:
                if block.get('blockBlockReason'):
                    impediments.append({
                        'tipo': 'Bloqueio',
                        'descricao': block['blockBlockReason'],
                        'inicio': block.get('blockStartPenaltyDate', ''),
                        'fim': block.get('blockEndPenaltyDate', ''),
                        'status': 'ATIVO' if not block.get('blockReleaseBlockDate') else 'LIBERADO'
                    })
    
    return impediments

def extract_background_info(data):
    background = {
        'federal': 'N/A',
        'mandados': 'N/A'
    }
    
    if 'sections' in data:
        if 'pfBackgroundCheckFederalPolice' in data['sections']:
            bg_data = data['sections']['pfBackgroundCheckFederalPolice']['data']
            background['federal'] = bg_data.get('status', 'N/A')
        
        if 'pfArrestWarrant' in data['sections']:
            warrant_data = data['sections']['pfArrestWarrant']['data']
            background['mandados'] = warrant_data.get('status', 'N/A')
    
    return background

def determine_aptitude(impediments, cnh_info):
    apto = True
    motivos = []
    
    for imp in impediments:
        if imp.get('status') == 'ATIVO':
            apto = False
            motivos.append(imp.get('descricao', 'Impedimento não especificado'))
    
    if cnh_info.get('validade'):
        validade_info = check_validity(cnh_info['validade'])
        if validade_info['status'] == 'vencida':
            apto = False
            motivos.append('CNH vencida')
    
    return {'apto': apto, 'motivos': motivos}

def check_validity(validade_str):
    if not validade_str:
        return {'status': 'indefinida', 'dias': 0}
    
    try:
        formats = ['%d/%m/%Y', '%Y-%m-%d', '%Y-%m-%dT%H:%M:%S.%fZ']
        validade_date = None
        
        for fmt in formats:
            try:
                if 'T' in validade_str:
                    validade_date = datetime.strptime(validade_str, '%Y-%m-%dT%H:%M:%S.%fZ')
                else:
                    validade_date = datetime.strptime(validade_str, fmt)
                break
            except:
                continue
        
        if not validade_date:
            return {'status': 'indefinida', 'dias': 0}
        
        hoje = datetime.now()
        dias_restantes = (validade_date - hoje).days
        
        if dias_restantes < 0:
            return {'status': 'vencida', 'dias': abs(dias_restantes)}
        elif dias_restantes <= 30:
            return {'status': 'proxima_vencer', 'dias': dias_restantes}
        else:
            return {'status': 'valida', 'dias': dias_restantes}
    except:
        return {'status': 'indefinida', 'dias': 0}

def analyze_driver_data(result):
    if not result or 'data' not in result:
        st.error("Dados não encontrados")
        return
    
    data = result['data']
    
    st.markdown("---")
    st.header("📊 Resultado da Análise CNH")
    
    person_info = extract_person_info(data)
    cnh_info = extract_cnh_info(data)
    impediments = extract_impediments(data)
    background_info = extract_background_info(data)
    
    _exibir_info_pessoal(person_info)
    _exibir_status_geral(impediments, cnh_info)
    _exibir_info_cnh(cnh_info)
    _exibir_impedimentos(impediments)
    _exibir_antecedentes(background_info)

def _exibir_info_pessoal(person_info):
    col1, col2 = st.columns([2, 1])
    
    with col1:
        st.subheader("👤 Informações Pessoais")
        info_df = pd.DataFrame([
            {"Campo": "Nome", "Valor": person_info.get('nome', 'N/A')},
            {"Campo": "CPF", "Valor": person_info.get('cpf', 'N/A')},
            {"Campo": "Data Nascimento", "Valor": person_info.get('nascimento', 'N/A')},
            {"Campo": "Idade", "Valor": f"{person_info.get('idade', 'N/A')} anos"},
            {"Campo": "Status CPF", "Valor": person_info.get('status_cpf', 'N/A')}
        ])
        st.dataframe(info_df, hide_index=True, use_container_width=True)

def _exibir_status_geral(impediments, cnh_info):
    col1, col2 = st.columns([2, 1])
    
    with col2:
        st.subheader("🎯 Status Geral")
        aptidao = determine_aptitude(impediments, cnh_info)
        
        if aptidao['apto']:
            st.success("✅ APTO PARA DIRIGIR")
        else:
            st.error("❌ NÃO APTO PARA DIRIGIR")
        
        if aptidao['motivos']:
            st.write("**Motivos:**")
            for motivo in aptidao['motivos']:
                st.write(f"• {motivo}")

def _exibir_info_cnh(cnh_info):
    st.subheader("🆔 Informações da CNH")
    col3, col4 = st.columns(2)
    
    with col3:
        cnh_df = pd.DataFrame([
            {"Campo": "Número", "Valor": cnh_info.get('numero', 'N/A')},
            {"Campo": "Categoria", "Valor": cnh_info.get('categoria', 'N/A')},
            {"Campo": "Status", "Valor": cnh_info.get('status', 'N/A')},
            {"Campo": "Validade", "Valor": cnh_info.get('validade', 'N/A')}
        ])
        st.dataframe(cnh_df, hide_index=True, use_container_width=True)
    
    with col4:
        validade_info = check_validity(cnh_info.get('validade'))
        if validade_info['status'] == 'valida':
            st.success(f"✅ CNH Válida por {validade_info['dias']} dias")
        elif validade_info['status'] == 'proxima_vencer':
            st.warning(f"⚠️ CNH vence em {validade_info['dias']} dias")
        elif validade_info['status'] == 'vencida':
            st.error(f"❌ CNH vencida há {validade_info['dias']} dias")

def _exibir_impedimentos(impediments):
    if impediments:
        st.subheader("⚠️ Impedimentos Detectados")
        imp_data = []
        for imp in impediments:
            imp_data.append({
                'Tipo': imp.get('tipo', ''),
                'Descrição': imp.get('descricao', ''),
                'Status': imp.get('status', ''),
                'Início': imp.get('inicio', 'N/A'),
                'Fim': imp.get('fim', 'N/A')
            })
        
        if imp_data:
            df = pd.DataFrame(imp_data)
            st.dataframe(df, hide_index=True, use_container_width=True)

def _exibir_antecedentes(background_info):
    st.subheader("🛡️ Antecedentes Criminais")
    col5, col6 = st.columns(2)
    
    with col5:
        if background_info['federal'] == 'NADA CONSTA':
            st.success("✅ Antecedentes Federais: LIMPO")
        else:
            st.info(f"ℹ️ Antecedentes Federais: {background_info['federal']}")
    
    with col6:
        if background_info['mandados'] == 'NADA CONSTA':
            st.success("✅ Mandados de Prisão: NADA CONSTA")
        else:
            st.warning(f"⚠️ Mandados: {background_info['mandados']}")

def secao_cnh():
    st.header("🚗 Consulta de Impedimentos CNH")
    
    if 'cnh_transaction_ids' not in st.session_state:
        st.session_state.cnh_transaction_ids = []
    
    st.markdown("""
    **Instruções:**
    1. Preencha os dados da pessoa que será consultada
    2. Clique em "Consultar CNH" para fazer a requisição
    3. Aguarde o processamento e veja os resultados
    """)
    
    with st.form("consulta_cnh_form"):
        st.subheader("👤 Dados da Pessoa")
        
        col1, col2 = st.columns(2)
        
        with col1:
            cpf = st.text_input("CPF *", placeholder="000.000.000-00", help="CPF da pessoa (apenas números ou com pontuação)")
            name = st.text_input("Nome Completo *", placeholder="JOÃO DA SILVA", help="Nome completo conforme documento")
            registration_number = st.text_input("Número de Registro CNH *", placeholder="00000000000", help="Número de registro da CNH")
        
        with col2:
            mother_name = st.text_input("Nome da Mãe", placeholder="MARIA DA SILVA", help="Nome completo da mãe")
            birth_date = st.date_input(
                "Data de Nascimento *",
                min_value=datetime(1900, 1, 1),
                max_value=datetime.now(),
                help="Data de nascimento",
                format="DD/MM/YYYY",
                value=None
            )
        
        submitted = st.form_submit_button("🔍 Consultar CNH", type="primary")
        
        if submitted:
            _realizar_consulta_cnh(cpf, name, birth_date, registration_number, mother_name)

def _realizar_consulta_cnh(cpf, name, birth_date, registration_number, mother_name):
    if not cpf or not name or not birth_date or not registration_number:
        st.error("❌ Por favor, preencha pelo menos CPF, Nome, Data de Nascimento e Número CNH")
        return
    
    cpf_clean = ''.join(filter(str.isdigit, cpf))
    
    if len(cpf_clean) != 11:
        st.error("❌ CPF deve ter 11 dígitos")
        return
    
    with st.spinner("🔄 Consultando CNH... Isso pode levar alguns minutos."):
        api_cnh = CombateFraudeAPI()
        result = api_cnh.consultar_cnh(
            cpf_clean,
            name.upper(),
            registration_number,
            mother_name.upper() if mother_name else "",
            birth_date.strftime("%Y-%m-%d")
        )
        
        if result:
            st.success("✅ Consulta CNH realizada com sucesso!")
            
            # Salvar no histórico
            salvar_pesquisa_cnh(name.upper(), cpf_clean, result['transaction_id'], result['data'])
            
            analyze_driver_data(result)
        else:
            st.error("❌ Erro na consulta CNH. Verifique os dados.")