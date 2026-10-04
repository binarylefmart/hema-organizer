import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyserIPv4,
  analyserIPv6,
  decoderEntites,
  estAdresseInterdite,
  estNomInterdit,
  extraireApercu,
  lireMetas,
  limiterAuHead,
  recupererApercu,
  recupererImage,
  resoudreUrlImage,
  typeContenuEstHtml,
  typeImageAutorise,
  validerUrlSaisie,
  type OptionsRecuperation,
} from "@/lib/lien-apercu";

/* --------------------------------------------------------------- */
/* Serveur HTTP local : aucun appel vers l'extérieur dans ces tests. */
/* --------------------------------------------------------------- */

const aFermer: (() => Promise<void>)[] = [];

async function serveurLocal(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const serveur = createServer(handler);
  await new Promise<void>((resoudre) => serveur.listen(0, "127.0.0.1", resoudre));
  const { port } = serveur.address() as AddressInfo;
  aFermer.push(() => new Promise<void>((resoudre) => serveur.close(() => resoudre())));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  while (aFermer.length) await aFermer.pop()!();
});

/**
 * Politique des tests : le serveur d'essai écoute forcément sur le bouclage, on l'autorise — mais
 * **toutes les autres règles restent celles de la production**, donc une redirection vers 10.0.0.1
 * est bien refusée par le vrai code.
 */
const options: OptionsRecuperation = {
  adresseInterdite: (ip) => ip !== "127.0.0.1" && estAdresseInterdite(ip),
  delaiMs: 3000,
};

const PAGE = `<!doctype html><html><head>
  <title>Titre de repli</title>
  <meta name="description" content="Description de repli">
  <meta property="og:title" content="Tournoi de Villebourg &amp; Cie">
  <meta property="og:description" content="Un tournoi d'épée longue le 12 octobre">
  <meta property="og:image" content="/img/affiche.png">
  <meta property="og:site_name" content="Cercle d'escrime ancienne">
</head><body>Corps ignoré</body></html>`;

function repondre(res: ServerResponse, corps: string | Buffer, type = "text/html; charset=utf-8", statut = 200) {
  res.writeHead(statut, { "content-type": type });
  res.end(corps);
}

/* --------------------------------------------------------------- */
/* 1. Validation de l'URL                                           */
/* --------------------------------------------------------------- */

describe("validation de l'URL saisie", () => {
  it("refuse tout ce qui n'est pas http(s)", () => {
    for (const mauvais of ["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "ftp://exemple.fr/x", "gopher://exemple.fr"]) {
      const r = validerUrlSaisie(mauvais);
      expect(r.ok, mauvais).toBe(false);
      if (!r.ok) expect(r.erreur).toMatch(/http/i);
    }
  });

  it("refuse le vide, l'illisible, les identifiants intégrés et les liens démesurés", () => {
    expect(validerUrlSaisie("").ok).toBe(false);
    expect(validerUrlSaisie("   ").ok).toBe(false);
    expect(validerUrlSaisie("https://").ok).toBe(false);
    expect(validerUrlSaisie("https://admin:motdepasse@exemple.fr/").ok).toBe(false);
    expect(validerUrlSaisie(`https://exemple.fr/${"a".repeat(3000)}`).ok).toBe(false);
  });

  it("accepte un lien public, complète le schéma manquant et retire l'ancre", () => {
    const r = validerUrlSaisie("escrime-ancienne.fr/agenda#ici");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.href).toBe("https://escrime-ancienne.fr/agenda");
  });

  it("refuse les noms qui désignent la machine ou le réseau interne", () => {
    for (const nom of ["localhost", "APP.localhost", "nas.local", "compta.internal", "imprimante.lan"]) expect(estNomInterdit(nom), nom).toBe(true);
    expect(estNomInterdit("escrime-ancienne.fr")).toBe(false);
  });

  it("refuse une IP privée écrite en littéral dans l'URL", () => {
    for (const mauvais of ["http://127.0.0.1/", "http://10.0.0.5/x", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/"]) {
      expect(validerUrlSaisie(mauvais).ok, mauvais).toBe(false);
    }
  });
});

/* --------------------------------------------------------------- */
/* 2. Jugement d'une adresse IP, sous toutes ses écritures          */
/* --------------------------------------------------------------- */

describe("jugement d'une adresse IP", () => {
  it("refuse les plages privées, locales, lien-local, multicast et réservées", () => {
    const interdites = [
      "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.254", "127.0.0.1", "127.1.2.3", "100.64.0.1",
      "169.254.169.254", "172.16.0.1", "172.20.10.1", "172.31.255.255", "192.168.0.1", "192.0.0.1",
      "192.0.2.4", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.9", "224.0.0.1", "239.1.1.1",
      "240.0.0.1", "255.255.255.255",
    ];
    for (const ip of interdites) expect(estAdresseInterdite(ip), ip).toBe(true);
  });

  it("refuse la même adresse privée écrite en décimal, octal, hexadécimal ou abrégé", () => {
    expect(analyserIPv4("2130706433")).toEqual([127, 0, 0, 1]);
    expect(analyserIPv4("0177.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(analyserIPv4("0x7f000001")).toEqual([127, 0, 0, 1]);
    expect(analyserIPv4("127.1")).toEqual([127, 0, 0, 1]);
    for (const forme of ["2130706433", "0177.0.0.1", "0x7f000001", "0x7f.0.0.1", "127.1", "017700000001", "3232235777"]) {
      expect(estAdresseInterdite(forme), forme).toBe(true);
    }
    // …et une URL construite avec ces formes est refusée (le navigateur/Node les normalise aussi)
    for (const mauvais of ["http://2130706433/", "http://0177.0.0.1/", "http://0x7f000001/", "http://127.1/"]) {
      expect(validerUrlSaisie(mauvais).ok, mauvais).toBe(false);
    }
  });

  it("refuse les IPv6 locales, y compris une IPv4 privée mappée", () => {
    const interdites = ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "2002:7f00:1::1", "64:ff9b::7f00:1"];
    for (const ip of interdites) expect(estAdresseInterdite(ip), ip).toBe(true);
    for (const mappee of ["::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:10.0.0.1]", "::ffff:192.168.1.1", "::127.0.0.1"]) {
      expect(estAdresseInterdite(mappee), mappee).toBe(true);
    }
    expect(analyserIPv6("::ffff:127.0.0.1")?.slice(12)).toEqual([127, 0, 0, 1]);
  });

  it("laisse passer les adresses publiques", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "157.240.1.35", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(estAdresseInterdite(ip), ip).toBe(false);
    }
  });

  it("refuse par défaut ce qu'elle ne sait pas analyser", () => {
    for (const bizarre of ["", "  ", "pas-une-ip", "999.999.999.999", "1.2.3.4.5", "::gggg", "12345678901234567890"]) {
      expect(estAdresseInterdite(bizarre), bizarre).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- */
/* 3. Extraction des balises                                        */
/* --------------------------------------------------------------- */

describe("extraction des balises", () => {
  it("préfère Open Graph et résout une image relative", () => {
    const a = extraireApercu(PAGE, "https://exemple.fr/agenda/tournoi");
    expect(a.titre).toBe("Tournoi de Villebourg & Cie");
    expect(a.description).toBe("Un tournoi d'épée longue le 12 octobre");
    expect(a.image).toBe("https://exemple.fr/img/affiche.png");
    expect(a.siteNom).toBe("Cercle d'escrime ancienne");
    expect(a.url).toBe("https://exemple.fr/agenda/tournoi");
  });

  it("retombe sur <title>, meta description et le nom d'hôte", () => {
    const html = `<html><head><title>  Le cercle\n  d'escrime ancienne </title><meta name="description" content="Section AMHE"></head></html>`;
    const a = extraireApercu(html, "https://www.escrime-ancienne.fr/page");
    expect(a.titre).toBe("Le cercle d'escrime ancienne");
    expect(a.description).toBe("Section AMHE");
    expect(a.siteNom).toBe("escrime-ancienne.fr");
    expect(a.image).toBeNull();
  });

  it("accepte les Twitter Cards, l'ordre inverse des attributs et les guillemets simples", () => {
    const html = `<head><meta content='Sur Twitter' name='twitter:title'><meta content="Résumé" property=twitter:description></head>`;
    const a = extraireApercu(html, "https://exemple.fr/");
    expect(a.titre).toBe("Sur Twitter");
    expect(a.description).toBe("Résumé");
  });

  it("résout les images relatives de toutes les formes et refuse data:/javascript:", () => {
    const base = "https://exemple.fr/agenda/tournoi";
    expect(resoudreUrlImage("affiche.png", base)).toBe("https://exemple.fr/agenda/affiche.png");
    expect(resoudreUrlImage("/a/b.png", base)).toBe("https://exemple.fr/a/b.png");
    expect(resoudreUrlImage("../haut.png", base)).toBe("https://exemple.fr/haut.png");
    expect(resoudreUrlImage("//cdn.exemple.fr/x.png", base)).toBe("https://cdn.exemple.fr/x.png");
    expect(resoudreUrlImage("https://cdn.exemple.fr/x.png?v=2&amp;t=3", base)).toBe("https://cdn.exemple.fr/x.png?v=2&t=3");
    expect(resoudreUrlImage("data:image/png;base64,AAAA", base)).toBeNull();
    expect(resoudreUrlImage("javascript:alert(1)", base)).toBeNull();
    expect(resoudreUrlImage("", base)).toBeNull();
  });

  it("tient compte de <base href> pour les chemins relatifs", () => {
    const html = `<head><base href="https://cdn.exemple.fr/v2/"><meta property="og:image" content="affiche.jpg"></head>`;
    expect(extraireApercu(html, "https://exemple.fr/page").image).toBe("https://cdn.exemple.fr/v2/affiche.jpg");
  });

  it("décode les entités et ne regarde que le <head>", () => {
    expect(decoderEntites("Caf&eacute; &amp; th&#233; &#x2014; fin")).toBe("Café & thé — fin");
    const html = `<head><meta property="og:title" content="Vrai"></head><body><meta property="og:title" content="Faux"></body>`;
    expect(limiterAuHead(html)).not.toContain("Faux");
    expect(extraireApercu(html, "https://exemple.fr/").titre).toBe("Vrai");
    expect(lireMetas("<head><meta property='og:title' content='X'></head>").get("og:title")).toBe("X");
  });

  it("plafonne la longueur des textes récupérés", () => {
    const html = `<head><meta property="og:title" content="${"a".repeat(500)}"><meta property="og:description" content="${"b".repeat(2000)}"></head>`;
    const a = extraireApercu(html, "https://exemple.fr/");
    expect(a.titre!.length).toBeLessThanOrEqual(200);
    expect(a.description!.length).toBeLessThanOrEqual(500);
  });

  it("juge les types de contenu", () => {
    expect(typeContenuEstHtml("text/html; charset=utf-8")).toBe(true);
    expect(typeContenuEstHtml("application/xhtml+xml")).toBe(true);
    expect(typeContenuEstHtml("application/json")).toBe(false);
    expect(typeContenuEstHtml(null)).toBe(false);
    expect(typeImageAutorise("image/png")).toBe("image/png");
    expect(typeImageAutorise("IMAGE/JPEG; q=1")).toBe("image/jpeg");
    // Un SVG est un document : il peut porter du script, et serait servi depuis notre origine
    expect(typeImageAutorise("image/svg+xml")).toBeNull();
    expect(typeImageAutorise("text/html")).toBeNull();
  });
});

/* --------------------------------------------------------------- */
/* 4. Récupération réseau (serveur local)                           */
/* --------------------------------------------------------------- */

describe("récupération d'un aperçu", () => {
  it("lit les balises d'une page servie localement", async () => {
    const base = await serveurLocal((req, res) => repondre(res, PAGE));
    const a = await recupererApercu(`${base}/agenda/tournoi`, options);
    expect(a.titre).toBe("Tournoi de Villebourg & Cie");
    expect(a.image).toBe(`${base}/img/affiche.png`);
    expect(a.url).toBe(`${base}/agenda/tournoi`);
  });

  it("suit une redirection légitime et renvoie l'URL finale", async () => {
    const base = await serveurLocal((req, res) => {
      if (req.url === "/depart") {
        res.writeHead(302, { location: "/arrivee" });
        res.end();
        return;
      }
      repondre(res, PAGE);
    });
    const a = await recupererApercu(`${base}/depart`, options);
    expect(a.url).toBe(`${base}/arrivee`);
    expect(a.titre).toBe("Tournoi de Villebourg & Cie");
  });

  it("refuse une redirection vers une adresse privée (revérification à chaque saut)", async () => {
    // 167772161 = 10.0.0.1 en décimal : la forme exotique ne contourne rien
    for (const cible of ["http://10.0.0.1/secret", "http://169.254.169.254/latest/meta-data/", "http://[::1]:80/", "http://167772161/", "http://[::ffff:10.0.0.1]/"]) {
      const base = await serveurLocal((req, res) => {
        res.writeHead(302, { location: cible });
        res.end();
      });
      await expect(recupererApercu(`${base}/depart`, options), cible).rejects.toThrow(/réseau (local|interne)/i);
    }
  });

  it("refuse une redirection vers un autre schéma", async () => {
    const base = await serveurLocal((req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    });
    await expect(recupererApercu(`${base}/x`, options)).rejects.toThrow(/http/i);
  });

  it("s'arrête après 3 redirections", async () => {
    const base = await serveurLocal((req, res) => {
      const n = Number(req.url?.slice(1) ?? 0);
      res.writeHead(302, { location: `/${n + 1}` });
      res.end();
    });
    await expect(recupererApercu(`${base}/0`, options)).rejects.toThrow(/redirections/i);
  });

  it("refuse un Content-Type qui n'est pas du HTML", async () => {
    const base = await serveurLocal((req, res) => repondre(res, JSON.stringify({ a: 1 }), "application/json"));
    await expect(recupererApercu(`${base}/x`, options)).rejects.toThrow(/page web/i);
  });

  it("remonte une erreur parlante sur un statut d'erreur", async () => {
    const base = await serveurLocal((req, res) => repondre(res, "nope", "text/html", 404));
    await expect(recupererApercu(`${base}/x`, options)).rejects.toThrow(/404/);
  });

  it("abandonne si le site met trop de temps", async () => {
    const base = await serveurLocal(() => {
      /* ne répond jamais */
    });
    await expect(recupererApercu(`${base}/x`, { ...options, delaiMs: 150 })).rejects.toThrow(/trop de temps/i);
  });

  it("ne lit qu'un début de page borné : une page démesurée est tronquée, pas avalée", async () => {
    const bourrage = "<!-- " + "x".repeat(300_000) + " -->";
    const base = await serveurLocal((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.write(`<head><meta property="og:title" content="Au début"></head><body>`);
      // 20 Mo si on laissait faire
      for (let i = 0; i < 70; i++) res.write(bourrage);
      res.end("</body>");
    });
    const a = await recupererApercu(`${base}/x`, { ...options, maxOctets: 64 * 1024 });
    expect(a.titre).toBe("Au début");
  });
});

describe("récupération d'une image distante", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

  it("rapatrie une image acceptée", async () => {
    const base = await serveurLocal((req, res) => repondre(res, PNG, "image/png"));
    const { octets, typeContenu } = await recupererImage(`${base}/affiche.png`, options);
    expect(typeContenu).toBe("image/png");
    expect(octets.byteLength).toBe(PNG.byteLength);
  });

  it("refuse une réponse trop grosse, annoncée ou non", async () => {
    const gros = Buffer.alloc(300 * 1024, 7);
    const menteur = await serveurLocal((req, res) => {
      res.writeHead(200, { "content-type": "image/png", "content-length": String(50 * 1024 * 1024) });
      res.end(PNG);
    });
    await expect(recupererImage(`${menteur}/x.png`, { ...options, maxOctets: 100 * 1024 })).rejects.toThrow(/volumineux/i);
    const silencieux = await serveurLocal((req, res) => {
      res.writeHead(200, { "content-type": "image/png" }); // sans content-length (chunked)
      res.end(gros);
    });
    await expect(recupererImage(`${silencieux}/x.png`, { ...options, maxOctets: 100 * 1024 })).rejects.toThrow(/volumineux/i);
  });

  it("refuse un SVG et tout ce qui n'est pas une image", async () => {
    const svg = await serveurLocal((req, res) => repondre(res, "<svg onload='alert(1)'></svg>", "image/svg+xml"));
    await expect(recupererImage(`${svg}/x.svg`, options)).rejects.toThrow(/image/i);
    const html = await serveurLocal((req, res) => repondre(res, PAGE));
    await expect(recupererImage(`${html}/x`, options)).rejects.toThrow(/image/i);
  });

  it("applique les mêmes refus d'adresse que l'aperçu", async () => {
    await expect(recupererImage("http://169.254.169.254/latest/meta-data/", {})).rejects.toThrow(/réseau (local|interne)/i);
    await expect(recupererImage("file:///etc/passwd", {})).rejects.toThrow(/http/i);
  });
});

describe("politique d'adresse", () => {
  it("ne peut pas être assouplie en production", async () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      // même avec une politique « tout est permis », le bouclage reste refusé
      await expect(recupererApercu("http://127.0.0.1:1/x", { adresseInterdite: () => false })).rejects.toThrow(/réseau (local|interne)/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
