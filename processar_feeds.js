const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const JSON_FEEDS_URL = "https://gist.githubusercontent.com/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = ["Observador", "Mega Hits", "Notícias ao Minuto", "SIC Notícias", "Público", "RTP", "Renascença", "NiT", "Lisboa Secreta"];

// Função de Tradução com Cache e limite de tempo
async function traduzirTexto(texto) {
    if (!texto || texto.length < 3) return texto;
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
        const res = await fetchUrl(url, 0, 5000); // Timeout curto para tradução não encravar o robô
        const json = JSON.parse(res);
        return json[0][0][0];
    } catch (e) { return texto; }
}

function fetchUrl(url, redirectCount = 0, customTimeout = 15000) {
    if (redirectCount > 5) return Promise.reject(new Error('Demasiados redirecionamentos'));
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Encoding': 'gzip, deflate',
                'Referer': 'https://www.google.com/'
            },
            timeout: customTimeout
        };

        const req = https.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const newLoc = res.headers.location.startsWith('http') ? res.headers.location : `https://${urlObj.hostname}${res.headers.location}`;
                return fetchUrl(newLoc, redirectCount + 1).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));

            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') {
                const gunzip = zlib.createGunzip();
                res.pipe(gunzip);
                stream = gunzip;
            } else if (res.headers['content-encoding'] === 'deflate') {
                const inflate = zlib.createInflate();
                res.pipe(inflate);
                stream = inflate;
            }

            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let encoding = 'utf-8';
                if (url.includes('record.pt') || url.includes('abola.pt') || url.includes('sapo.pt')) encoding = 'latin1';
                resolve(buffer.toString(encoding));
            });
            stream.on('error', err => reject(err));
        });
        req.on('error', err => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function cleanText(txt) {
    if (!txt) return "";
    let str = txt.replace(/&lt;!\[CDATA\[|\]\]&gt;|CDATA\[|\]\]/gi, "");
    str = str.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    const mapa = { 'Ã³': 'ó', 'Ã§': 'ç', 'Ã£': 'ã', 'Ã©': 'é', 'Ã¡': 'á', 'Ã­': 'í', 'Ã¢': 'â', 'Ãª': 'ê', 'Ãµ': 'õ', 'Ãº': 'ú', 'Ã ': 'à', 'Âº': 'º' };
    for (let erro in mapa) { str = str.split(erro).join(mapa[erro]); }
    return str.replace(/\s+/g, " ").trim();
}

async function processarFeed(feed) {
    try {
        const xml = await fetchUrl(feed.u);
        const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        const artigos = [];
        let match;
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 10) {
            const itemXml = match[2];
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let title = cleanText(titleMatch ? titleMatch[1] : "");
            if (!title) continue;

            if (feed.l === "en") title = await traduzirTexto(title);

            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || itemXml.match(/href=["']([^"']+)["']/);
            let link = (linkMatch ? (linkMatch[1] || linkMatch[0]) : "").trim();
            if (link.includes('href=')) {
                const m = link.match(/href=["']([^"']+)["']/);
                link = m ? m[1] : link;
            }

            const pubDateMatch = itemXml.match(/<(pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/\1>/i);
            let dateVal = pubDateMatch ? new Date(pubDateMatch[2]) : new Date();
            if (isNaN(dateVal)) dateVal = new Date();

            let thumb = "";
            const tagsImg = itemXml.match(/<(?:media:content|enclosure|media:thumbnail|image|webfeeds:featuredImage)[^>]+?\b(?:url|href|src)\s*=\s*["']([^"'\s>]+)/i);
            if (tagsImg) thumb = tagsImg[1];
            if (!thumb) {
                const imgInText = itemXml.match(/<img[^>]+?\b(?:src|data-src)\s*=\s*["']([^"'\s>]+)/i);
                if (imgInText) thumb = imgInText[1];
            }

            artigos.push({
                t: title,
                l: link,
                i: thumb ? thumb.replace(/&amp;/g, "&").trim() : "",
                p: dateVal.toISOString(),
                fav: `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feed.u).hostname}`,
                n: feed.n.trim(),
                c: feed.c
            });
            contador++;
        }
        console.log(`[OK] ${feed.n}: ${artigos.length} artigos.`);
        return artigos;
    } catch (e) {
        console.log(`[FALHA] ${feed.n}: ${e.message}`);
        return [];
    }
}

async function ejecutar() {
    console.log("Iniciando processamento...");
    try {
        const fontesRaw = await fetchUrl(JSON_FEEDS_URL);
        const fontes = JSON.parse(fontesRaw);
        let todosArtigosPlanos = [];
        let gruposNoticias = [];

        for (const fonte of fontes) {
            const artigos = await processarFeed(fonte);
            if (artigos.length > 0) {
                todosArtigosPlanos = todosArtigosPlanos.concat(artigos);
                gruposNoticias.push({ nome: fonte.n.trim(), categoria: fonte.c, artigos });
            }
        }

        todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));
        
        gruposNoticias.sort((a, b) => {
            return new Date(groupsDate(b)) - new Date(groupsDate(a));
        });

        function groupsDate(g) { return g.artigos[0].p; }

        const resultado = {
            ultimasAtualizacao: new Date().toISOString(),
            fontesAtivas: fontes.filter(f => gruposNoticias.some(g => g.nome === f.n.trim())),
            todosArtigosPlanos,
            gruposPorPrioridade: gruposNoticias
        };

        fs.writeFileSync('noticias_final.json', JSON.stringify(resultado, null, 2));
        console.log(`Sucesso! Total de artigos: ${todosArtigosPlanos.length}`);
    } catch (err) { console.error("Erro Fatal:", err); }
}
ejecutar();
