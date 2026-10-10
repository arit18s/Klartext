// Builds videos/klartext-slides-videos.pptx: slides 0–3 as the exported PNGs, then the backup
// section with one embedded screen video per demo step (videos/, git-ignored). Run from docs/pitch:
//   node build-video-deck.js
// Clip 10 (Outcept) is still missing: its slide holds a marked empty frame of the same size.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");

const DIR = __dirname;
const VID = path.join(DIR, "videos");
// NO_AUTOPLAY=1 builds a fallback without the added timing (videos then start on a click).
const NO_AUTOPLAY = !!process.env.NO_AUTOPLAY;
const OUT = path.join(VID, NO_AUTOPLAY ? "klartext-slides-videos-click.pptx" : "klartext-slides-videos.pptx");

// Klartext tokens (docs/04_FRONTEND_GUIDELINES.md); 1920 px = 13.333 in, so px / 144 = in.
const T = { graphite: "1E2126", soft: "3A3E45", muted: "666A72", line: "E6E6E2", canvas: "F5F5F3", paper: "FFFFFF" };
const px = (v) => v / 144;
const FONT = "Arial";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#1E2126"/><rect x="6" y="11" width="2" height="6" rx="1" fill="#FFF"/><rect x="9.5" y="8" width="2" height="12" rx="1" fill="#FFF"/><rect x="13" y="5" width="2" height="18" rx="1" fill="#F2C744"/><rect x="16.5" y="8" width="2" height="12" rx="1" fill="#FFF"/><rect x="20" y="11" width="2" height="6" rx="1" fill="#FFF"/></svg>`;

const CLIPS = [
  { file: "01-pipeline-inbox", kicker: "1. A call arrives",
    title: "A recording lands, the alert is at the top of the Inbox",
    say: "Nobody uploads anything. A call ends, the recording lands, Klartext checks it, and the alert is waiting in the Inbox." },
  { file: "03-demo-call", kicker: "1. A call arrives",
    title: "The alert, explained: access code shared, raised by the customer",
    say: "The customer reads out a live login code, even though the advisor told her twice not to. Klartext flags it, and marks the customer as the one who raised it." },
  { file: "04-d06", kicker: "2. Keywords without risk",
    title: "Seven keyword hits, no alert",
    say: "Password, TAN, confirmation code: a keyword filter raises an alert here. Klartext reads the context: a help page, nothing live." },
  { file: "05-c10", kicker: "2. Same digits, no alert",
    title: "Same six digits, no alert: the context twin",
    say: "Keywords tell us where to look; context tells us what it means." },
  { file: "06-c17", kicker: "3. When the call doesn’t settle it",
    title: "Review, with what is missing to decide",
    say: "When Klartext can’t know, it says exactly what’s missing and hands it to a human." },
  { file: "07-tuning", kicker: "4. Compliance sets how strict it is",
    title: "Move the threshold, see the cost live",
    say: "Lower the alert threshold to 50: five reviews become alerts. Compliance sees the cost before saving." },
  { file: "08-rules", kicker: "4. Compliance sets how strict it is",
    title: "Each category is a rule in plain language",
    say: "Every change is a new version in the audit log, and no developer is needed." },
  { file: "09-quality", kicker: "5. Quality, measured honestly",
    title: "Holdout: recall 1.00, precision 0.91",
    say: "Our numbers come from calls we never tuned on." },
  { file: "10-outcept", kicker: "5. Handover to Outcept",
    title: "From the Outcept list to the exact passage in one click",
    say: "Every alert and review goes to Outcept with a link to the exact passage." },
];

function durationMs(file) {
  const out = require("child_process")
    .execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
    .toString();
  return Math.round(parseFloat(out) * 1000);
}

async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "Klartext";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const logo = "image/png;base64," + (await sharp(Buffer.from(LOGO_SVG)).png().toBuffer()).toString("base64");

  pres.addSection({ title: "Pitch" });
  for (const img of ["0-title.png", "1-architecture.png", "2-operating-concept.png", "3-detection-quality.png"]) {
    const s = pres.addSlide({ sectionTitle: "Pitch" });
    s.addImage({ path: path.join(DIR, img), x: 0, y: 0, w: 13.333, h: 7.5, altText: img });
  }

  pres.addSection({ title: "Backup" });
  const div = pres.addSlide({ sectionTitle: "Backup" });
  div.background = { color: T.paper };
  div.addImage({ data: logo, x: px(160), y: px(150), w: px(34), h: px(34), altText: "Klartext logo" });
  div.addText("Klartext", { x: px(206), y: px(146), w: 3, h: px(42), fontSize: 11, bold: true, color: T.graphite, margin: 0, isTextBox: true });
  div.addText("Backup", { x: px(160), y: px(230), w: 6, h: px(30), fontSize: 10, color: T.muted, margin: 0, isTextBox: true });
  div.addText("Backup: demo videos", { x: px(160), y: px(266), w: 11, h: px(90), fontSize: 36, bold: true, color: T.graphite, margin: 0, isTextBox: true });
  div.addText("The live demo, recorded on the real 60 calls plus the dropped demo call, in case the live demo fails.",
    { x: px(160), y: px(376), w: px(1500), h: px(50), fontSize: 14, color: T.soft, margin: 0, isTextBox: true });
  const items = CLIPS.map((c, i) => ({ text: c.title, options: { bullet: { type: "number" }, breakLine: i < CLIPS.length - 1 } }));
  div.addText(items.slice(0, 5), { x: px(160), y: px(480), w: px(760), h: px(400), fontSize: 13, color: T.soft, valign: "top", paraSpaceAfter: 8, margin: 0, isTextBox: true });
  div.addText(items.slice(5).map((it, i) => ({ text: it.text, options: { bullet: { type: "number", numberStartAt: 6 }, breakLine: i < 3 } })),
    { x: px(1000), y: px(480), w: px(760), h: px(400), fontSize: 13, color: T.soft, valign: "top", paraSpaceAfter: 8, margin: 0, isTextBox: true });

  // Video frame: height 810 px like the screenshots; the recordings are 1280 × 768 (5:3), so 1350 px wide.
  const vh = px(810), vw = px(1350), vx = (13.333 - px(1350)) / 2, vy = px(230);
  const autoplay = [];
  CLIPS.forEach((c, i) => {
    const s = pres.addSlide({ sectionTitle: "Backup" });
    s.background = { color: T.paper };
    s.addText(`Backup · ${c.kicker}`, { x: px(96), y: px(44), w: 12, h: px(30), fontSize: 10, color: T.muted, margin: 0, isTextBox: true });
    s.addText(c.title, { x: px(96), y: px(78), w: px(1728), h: px(60), fontSize: 24, bold: true, color: T.graphite, margin: 0, isTextBox: true });
    s.addText([{ text: "Say: ", options: { color: T.muted } }, { text: `“${c.say}”`, options: { color: T.soft } }],
      { x: px(96), y: px(146), w: px(1728), h: px(70), fontSize: 13, valign: "top", margin: 0, isTextBox: true });
    s.addNotes(c.say);
    const mp4 = path.join(VID, c.file + ".mp4");
    if (fs.existsSync(mp4)) {
      const cover = "data:image/png;base64," + fs.readFileSync(path.join(VID, c.file + ".png")).toString("base64");
      s.addMedia({ type: "video", path: mp4, cover, x: vx, y: vy, w: vw, h: vh });
      autoplay.push({ slide: 6 + i, ms: durationMs(mp4) });
    } else {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: vx, y: vy, w: vw, h: vh, rectRadius: 0.12,
        fill: { color: T.canvas }, line: { color: "A9ACB2", width: 1.5, dashType: "dash" } });
      s.addText([{ text: `Platz für Video ${c.file}`, options: { bold: true, breakLine: true } },
                 { text: "Video einfügen: Einfügen → Video → Dieses Gerät, auf diesen Rahmen legen, dann den Rahmen löschen." }],
        { x: vx, y: vy + vh / 2 - 0.5, w: vw, h: 1, fontSize: 14, color: T.muted, align: "center", margin: 0, isTextBox: true });
    }
  });

  await pres.writeFile({ fileName: OUT });
  await addAutoplay(OUT, autoplay);
  console.log("wrote", OUT);
}

// pptxgenjs writes videos without a timing node (play on click on the video only). Add the timing
// PowerPoint writes for "Start: Automatically", so each video starts when its slide opens.
async function addAutoplay(file, list) {
  const JSZip = require("jszip");
  // Copy into a fresh ZIP without folder entries: those make PowerPoint refuse or "repair" the file.
  const src = await JSZip.loadAsync(fs.readFileSync(file));
  const zip = new JSZip();
  const names = Object.keys(src.files).filter((n) => !src.files[n].dir);
  names.sort((a, b) => (a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0));
  for (const n of names) zip.file(n, await src.file(n).async("nodebuffer"), { createFolders: false });
  for (const { slide, ms } of list) {
    const name = `ppt/slides/slide${slide}.xml`;
    let xml = await zip.file(name).async("string");
    // pptxgenjs gives the video the same shape id as a text box; give it a free one.
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => +m[1]);
    const id = String(Math.max(...ids) + 1);
    const before = xml;
    xml = xml.replace(/<p:cNvPr id="\d+" name="Media 0">/, `<p:cNvPr id="${id}" name="Media 0">`);
    if (xml === before) throw new Error("no video on " + name);
    const timing =
      `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
      `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
      `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>` +
      `<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
      `<p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
      `<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="${ms}" fill="hold"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:cmd>` +
      `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>` +
      `</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
      `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
      `<p:video><p:cMediaNode vol="80000" mute="1"><p:cTn id="7" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn>` +
      `<p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cMediaNode></p:video>` +
      `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
    xml = xml.replace(/<p:timing>[\s\S]*?<\/p:timing>/, "");
    if (!NO_AUTOPLAY) xml = xml.replace(/(<\/p:clrMapOvr>|<\/p:cSld>(?![\s\S]*<p:clrMapOvr>))/, `$1${timing}`);
    zip.file(name, xml, { createFolders: false });
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

main().catch((e) => { console.error(e); process.exit(1); });
