// Script para corrigir encoding UTF-8 no app.js
// Problema: arquivo foi salvo com double-encoding UTF-8
const fs = require('fs');

const filePath = 'c:/Users/Gui/Desktop/Icarus/frontend/app.js';

// Ler arquivo como buffer para ter controle total
let buffer = fs.readFileSync(filePath);
let content = buffer.toString('utf8');

console.log('Tamanho original:', content.length);

// Lista de substituicoes - mojibake para emoji correto
// Formato: [string_quebrada, emoji_correto]
const fixes = [
    // Emojis mais comuns no Icarus
    ['\u00f0\u0178\u201c\u00b1', '\u{1F4F1}'], // mobile phone
    ['\u00f0\u0178\u201d\u00a5', '\u{1F525}'], // fire
    ['\u00f0\u0178\u201d\u201e', '\u{1F504}'], // arrows
    ['\u00f0\u0178\u201c\u00b4', '\u{1F534}'], // red circle
    ['\u00f0\u0178\u201c\u00b7', '\u{1F4F7}'], // camera
    ['\u00f0\u0178\u201c\u00a2', '\u{1F4E2}'], // megaphone
    ['\u00f0\u0178\u2019\u00a7', '\u{1F4A7}'], // droplet
    ['\u00f0\u0178\u201d\u008d', '\u{1F50D}'], // search
    ['\u00f0\u0178\u201c\u0160', '\u{1F4CA}'], // chart
    ['\u00f0\u0178\u201c\u00c8', '\u{1F4C8}'], // chart up
    ['\u00f0\u0178\u201c\u2039', '\u{1F4CB}'], // clipboard
    ['\u00f0\u0178\u201c\u00a6', '\u{1F4E6}'], // package
    ['\u00f0\u0178\u201d\u00a7', '\u{1F527}'], // wrench
    ['\u00f0\u0178\u2019\u00a1', '\u{1F4A1}'], // bulb
    ['\u00f0\u0178\u201c\u201e', '\u{1F4C4}'], // doc
    ['\u00f0\u0178\u2019\u0161', '\u{1F49A}'], // green heart
    ['\u00f0\u0178\u2019\u2122', '\u{1F499}'], // blue heart
    ['\u00f0\u0178\u017d\u00af', '\u{1F3AF}'], // target
    ['\u00f0\u0178\u201c\u0152', '\u{1F4CC}'], // pushpin
    ['\u00f0\u0178\u201c\u0085', '\u{1F4C5}'], // calendar
    ['\u00f0\u0178\u201c\u017e', '\u{1F4DE}'], // phone
    ['\u00f0\u0178\u201d\u017d', '\u{1F50E}'], // search right
    ['\u00f0\u0178\u201c\u009d', '\u{1F4DD}'], // memo
    ['\u00f0\u0178\u2013\u00a8', '\u{1F5A8}'], // printer
    ['\u00f0\u0178\u2019\u00a8', '\u{1F6A8}'], // siren
    ['\u00f0\u0178\u0152\u0090', '\u{1F310}'], // globe
    ['\u00f0\u0178\u201c\u201d', '\u{1F4CD}'], // pin
    ['\u00f0\u0178\u201c\u00a4', '\u{1F4E4}'], // outbox
    ['\u00f0\u0178\u201c\u00ac', '\u{1F4EC}'], // mailbox
    ['\u00f0\u0178\u2020\u0098', '\u{1F198}'], // SOS
    ['\u00f0\u0178\u017d\u2020', '\u{1F3C6}'], // trophy
    ['\u00f0\u0178\u017d\u0026', '\u{1F3C5}'], // medal
    ['\u00f0\u0178\u2022', '\u{1F550}'], // clock (partial)
    ['\u00f0\u0178\u2020', '\u{1F3C6}'], // trophy variant
    ['\u00f0\u0178\u0026\u0085', '\u{1F3C5}'], // medal variant
    
    // Novos padroes encontrados
    ['\u00f0\u0178\u201d\u00a5', '\u{1F525}'], // fire
    ['\u00f0\u0178\u0095', '\u{1F550}'], // clock
    ['\u00f0\u0178\u2020 T', '\u{1F3C6} T'], // trophy
    ['\u00f0\u0178\u201c\u02c6 E', '\u{1F4C8} E'], // chart up
    ['\u00f0\u0178\u0085 T', '\u{1F3C5} T'], // medal
    ['\u00f0\u0178\u201c\u0152 C', '\u{1F4CC} C'], // pushpin
    ['\u00f0\u0178\u201c\u0085 A', '\u{1F4C5} A'], // calendar
    ['\u00f0\u0178\u201d\u017d D', '\u{1F50E} D'], // search
    
    // Padroes exatos encontrados (novos)
    ['\u00f0\u0178\u201c\u00a5', '\u{1F4E5}'], // inbox
    ['\u00f0\u0178\u201c\u008d', '\u{1F4CD}'], // pin map
    ['\u00f0\u0178\u008f\u2020', '\u{1F3C6}'], // trophy
    ['\u00f0\u0178\u008f\u2026', '\u{1F3C5}'], // medal
    ['\u00f0\u0178\u201d\u0152', '\u{1F50C}'], // plug
    ['\u00f0\u0178\u201c\u2026', '\u{1F4C5}'], // calendar
    ['\u00f0\u0178\u201c\u017d', '\u{1F50E}'], // search magnifying glass
    
    // Variantes adicionais
    ['\u00c3\u00a2\u00e2\u201a\u00ac\u0178', '\u{26A0}\uFE0F'], // warning emoji
    ['\u00e2\u0153\u0178', '\u{2714}'], // check mark
    ['\u00e2\u0153\u2026', '\u{2705}'], // white check mark
    ['\u00e2\u0161\u00a0', '\u{26A0}'], // warning
    ['\u00e2\u0161\u00a1', '\u{26A1}'], // lightning
    ['\u00e2\u201e\u00b9', '\u{2139}'], // info
    ['\u00e2\u0153\u02dc', '\u{2718}'], // X mark
    
    // Check marks e X marks
    ['\u00e2\u0153\u201c', '\u{2714}'], // check mark (âœ")
    ['\u00e2\u0153\u2014', '\u{2718}'], // X mark (âœ—)
    ['\u00e2\u0153\u201d', '\u{2714}'], // check mark variant
];

let fixCount = 0;
for (const [broken, correct] of fixes) {
    const regex = new RegExp(broken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
        fixCount += matches.length;
        content = content.replace(regex, correct);
    }
}

console.log('Correcoes aplicadas:', fixCount);

// Salvar
fs.writeFileSync(filePath, content, 'utf8');
console.log('Arquivo salvo! Tamanho:', content.length);

// Verificar se ainda tem problemas
const remaining = (content.match(/\u00f0\u0178/g) || []).length;
console.log('Padroes mojibake restantes:', remaining);
