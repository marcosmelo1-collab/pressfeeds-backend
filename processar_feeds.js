const fs = require('fs');
const https = require('https');

// Configurações dos URLs base
const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = [
    "Observador", "Mega Hits", "Notícias ao Minuto", "Vagalume", 
    "SIC Notícias", "Papelpop", "Magazine HD", "RTP", 
    "PopNow", "Renascença", "In Magazine", "Billboard", "NiT"
];

// ALTERAÇÃO 1: fetchUrl robusto com User-Agent real, Timeout de 15s e suporte a Redirecionamento
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
            timeout: 15000 // 15 segundos para evitar falhas em sites lentos
        };

        https.get(url, options, (res) => {
            // Seguir redirecionamentos (importante para NiT e Lisboa Secreta)
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const bufferCompleto = Buffer.concat(chunks);
                
                let encoding = 'utf-8';
                const contentType = res.headers['content-type'] || '';
                if (contentType.toLowerCase().includes('iso-8859-1') || contentType.toLowerCase().includes('windows-1252')) {
                    encoding = 'latin1';
                }
                
                if (encoding === 'utf-8') {
                    const amostraTexto = bufferCompleto.slice(0, 250).toString('ascii');
                    if (amostraTexto.toLowerCase().includes('encoding="iso-8859-1"') || 
                        amostraTexto.toLowerCase().includes('encoding="windows-1252"')) {
                        encoding = 'latin1';
                    }
                }
                
                const urlLower = url.toLowerCase();
                if (urlLower.includes('abola.pt') || urlLower.includes('record.pt')) {
                    encoding = 'latin1';
                }
                
                let textoDecodificado = bufferCompleto.toString(encoding);
                
                if (textoDecodificado.includes('\u00c3') || textoDecodificado.includes('\u00e3')) {
                    try {
                        textoDecodificado = decodeURIComponent(escape(textoDecodificado));
                    } catch(e) {}
                }
                
                resolve(textoDecodificado);
            });
        }).on('error', err => reject(err)).on('timeout', () => {
            reject(new Error('Timeout após 15 segundos'));
        });
    });
}

function cleanText(txt) {
    if (!txt) return "";
    let str = txt;
    str = str.replace(/<!\[CDATA\[/gi, "").replace(/\]\]>/gi, "").replace(/CDATA/g, "");
    str = str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    str = str.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "");
    return str.replace(/\s+/g, " ").trim();
}

function getFav(url) {
    try {
        const hostname = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
    } catch (e) { return ""; }
}

async function traduzirTexto(texto) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
        const res = await fetchUrl(url);
        const json = JSON.parse(res);
        return json[0][0][0];
    } catch (e) { return texto; }
}

function formatarData(dateObj) {
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    return `${dateObj.getDate()} de ${meses[dateObj.getMonth()]} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
}

function extrairImagemDoTexto(texto) {
    if (!texto) return "";
    const imgRegex = /<img[^>]+?\b(?:src|data-src|data-lazy-src|data-original|url)\s*=\s*["']([^"'\s>]+)/i;
    let match = texto.match(imgRegex);
    if (match && match[1] && match[1].length > 10 && !match[1].includes("favicon")) return match[1].trim().replace(/&amp;/g, "&");
    const urlRegex = /(https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp|gif))/i;
    match = texto.match(urlRegex);
    return match ? match[1].trim() : "";
}

async function processarFeed(feed) {
    try {
        const xmlRaw = await fetchUrl(feed.u);
        const xml = xmlRaw.replace(/^\uFEFF/, '').trim();
        if (!xml.startsWith('<')) return [];
        
        // ALTERAÇÃO 2: Regex flexível para capturar <item> (RSS) ou <entry> (Atom)
        const itemRegex = /<(item|entry)>([\s\S]*?)<\/(item|entry)>/gi;
        let match;
        const artigos = [];
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 9) {
            const itemXml = match[1];
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let title = cleanText(titleMatch ? titleMatch[1] : "");
            if (!title) continue;

            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            let link = linkMatch ? linkMatch[1].trim() : "";
            // Se o link for um Atom link (tag completa), extrai o href
            if (link.includes('href=')) {
                const hrefMatch = link.match(/href=["']([^"']+)["']/);
                link = hrefMatch ? hrefMatch[1] : link;
            }

            const pubDateMatch = itemXml.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i);
            const pubDate = pubDateMatch ? new Date(pubDateMatch[2]) : new Date();

            if (feed.l === "en") title = await traduzirTexto(title);

            let thumb = "";
            const tagsImagem = itemXml.match(/<(?:media:content|enclosure|media:thumbnail)[^>]+>/gi);
            if (tagsImagem) {
                for (const tag of tagsImagem) {
                    const urlMatch = tag.match(/\burl\s*=\s*["']([^"'\s>]+)/i);
                    if (urlMatch && urlMatch[1] && urlMatch[1].length > 10) { thumb = urlMatch[1].trim(); break; }
                }
            }
            if (!thumb) {
                const descMatch = itemXml.match(/<(description|content|summary)[^>]*>([\s\S]*?)<\/\1>/i);
                thumb = extrairImagemDoTexto(descMatch ? descMatch[2] : "");
            }

            let fallbackImg = `https://images.weserv.nl/?url=${encodeURIComponent(getFav(feed.u))}&w=120&h=120&fit=contain`;

            // ALTERAÇÃO 3: Inclusão do campo "c" (categoria) em cada artigo
            artigos.push({
                t: title,
                l: link,
                i: (thumb && thumb.length > 10) ? thumb.replace(/&amp;/g, "&") : "",
                fallback: fallbackImg,
                p: pubDate.toISOString(),
                data_formatada: formatarData(pubDate),
                fav: getFav(feed.u),
                n: feed.n,
                c: feed.c // Categoria da fonte agora gravada na notícia
            });
            contador++;
        }
        return artigos;
    } catch (e) {
        console.error(`Erro em ${feed.n}:`, e.message);
        return [];
    }
}

async function ejecutar() {
    console.log("A iniciar processamento...");
    try {
        const fontesRaw = await fetchUrl(JSON_FEEDS_URL);
        const fontes = JSON.parse(fontesRaw);
        let todosArtigosPlanos = [];
        let gruposNoticias = [];

        for (const fonte of fontes) {
            console.log(`A recolher: ${fonte.n}`);
            const artigosDaFonte = await processarFeed(fonte);
            if (artigosDaFonte.length > 0) {
                todosArtigosPlanos = todosArtigosPlanos.concat(artigosDaFonte);
                gruposNoticias.push({ nome: fonte.n, categoria: fonte.c, artigos: artigosDaFonte });
            }
        }

        todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));
        gruposNoticias.sort((a, b) => {
            const idxA = priorityOrder.indexOf(a.nome);
            const idxB = priorityOrder.indexOf(b.nome);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });

        const fontesAtivas = fontes.filter(f => gruposNoticias.some(g => g.nome === f.n));
        const resultadoFinal = {
            ultimasAtualizacao: new Date().toISOString(),
            fontesAtivas: fontesAtivas,
            todosArtigosPlanos: todosArtigosPlanos, 
            gruposPorPrioridade: gruposNoticias 
        };

        fs.writeFileSync('noticias_final.json', JSON.stringify(resultadoFinal, null, 2));
        console.log("Sucesso!");
    } catch (err) {
        console.error("Erro fatal:", err.message);
    }
}
ejecutar();
