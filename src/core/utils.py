import re
from datetime import datetime

def limpar_texto(texto):
    if not texto: 
        return texto
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

def clean_cpf(cpf):
    return re.sub(r'\D', '', cpf)