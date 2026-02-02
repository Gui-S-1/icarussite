#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re

# Ler arquivo
with open('frontend/app.js', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Mapa de substituições - mojibake UTF-8 para emojis corretos
replacements = {
    'ðŸš€': '🚀',
    'ðŸ"±': '📱',
    'ðŸ"¥': '🔥',
    'ðŸ"„': '🔄',
    'ðŸŒ': '🌐',
    'ðŸš¨': '🚨',
    'ðŸ"': '📍',
    'ðŸ"·': '📷',
    'ðŸ"¢': '📢',
    'ðŸ'§': '💧',
    'ðŸ"': '🔍',
    'ðŸ"Š': '📊',
    'ðŸ"‹': '📋',
    'ðŸ"¦': '📦',
    'ðŸ"§': '🔧',
    'ðŸ"©': '📩',
    'ðŸ'¡': '💡',
    'ðŸ"ˆ': '📈',
    'ðŸ—"': '🗓',
    'ðŸ"': '📄',
    'âœ…': '✅',
    'âš ': '⚠',
    'âš¡': '⚡',
    'â„¹': 'ℹ',
    'âœ"': '✔',
    'Ã¡': 'á',
    'Ã©': 'é',
    'Ã­': 'í',
    'Ã³': 'ó',
    'Ãº': 'ú',
    'Ã£': 'ã',
    'Ãµ': 'õ',
    'Ã§': 'ç',
    'Ãª': 'ê',
    'Ã´': 'ô',
    'Ã‰': 'É',
    'Ã‡': 'Ç',
    'Ã€': 'À',
    'A—': '×',
    'âš ï¸': '⚠️',
}

# Aplicar substituições
for old, new in replacements.items():
    content = content.replace(old, new)

# Salvar arquivo
with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Arquivo corrigido! {len(content)} caracteres")
