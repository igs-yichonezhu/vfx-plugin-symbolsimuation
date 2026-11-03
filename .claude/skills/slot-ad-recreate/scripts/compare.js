// 競品 vs 我們 並排對比影片：左競品（依我們的節拍剪段）、右我們，上方標籤，聲音用我們的
// node compare.js <案子資料夾>   讀 <案子>/compare.json：
//   { "ref": "競品影片", "ours": "deliver/我們.mp4", "out": "deliver/對比.mp4", "duration": 29.5,
//     "labels": ["競品（實機錄影）", "我們（v1）"],
//     "segments": [[競品開始秒, 結束秒, 速度], ...] }   每段依序接起來，對齊我們每一段的長度；最後不夠長就停在最後一格
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const CASE = path.resolve(process.argv[2] || ".");
const C = JSON.parse(fs.readFileSync(path.join(CASE, "compare.json"), "utf8"));
const abs = (p) => (path.isAbsolute(p) ? p : path.join(CASE, p));
const labels = path.join(CASE, "chk", "compare_labels.png");
fs.mkdirSync(path.dirname(labels), { recursive: true });
const py = "import sys\nfrom PIL import Image, ImageDraw, ImageFont\nf=ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc',30)\n" +
  "im=Image.new('RGBA',(1080,960),(0,0,0,0));d=ImageDraw.Draw(im)\n" +
  "for x,t in [(0,sys.argv[2]),(540,sys.argv[3])]:\n  d.rectangle([x,0,x+540,44],fill=(0,0,0,170));d.text((x+14,5),t,font=f,fill=(255,230,120))\nim.save(sys.argv[1])\n";
cp.execFileSync("python", ["-I", "-c", py, labels, C.labels[0], C.labels[1]]);
let fc = "", ins = "";
C.segments.forEach(([a, b, k], i) => { fc += `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${k || 1},scale=540:960,fps=30,setsar=1[s${i}];`; ins += `[s${i}]`; });
fc += `${ins}concat=n=${C.segments.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=10[c];[1:v]scale=540:960,setsar=1[o];[c][o]hstack[h];[h][2:v]overlay=0:0[v]`;
cp.execFileSync("ffmpeg", ["-v", "error", "-y", "-i", abs(C.ref), "-i", abs(C.ours), "-i", labels, "-filter_complex", fc,
  "-map", "[v]", "-map", "1:a", "-t", String(C.duration), "-c:v", "libx264", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
  "-movflags", "+faststart", abs(C.out)], { stdio: "inherit" });
console.log("wrote", abs(C.out));
