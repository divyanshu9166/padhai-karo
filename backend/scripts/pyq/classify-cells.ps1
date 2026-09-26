# Classify answer-key table cells as A/B/C/D/X/0 by template matching (no OCR, no network).
#
# Official answer keys are typed in a standard font, so each cell's glyph is compared against
# letters rendered in common fonts. Every cell gets the best label, a similarity score and the
# margin over the runner-up; the extractor sends low-score/low-margin cells (hand-written
# corrections, stamps, smudges) to human review instead of guessing.
#
# Usage: powershell -NoProfile -File classify-cells.ps1 -Image page.png -Cells cells.json -OutFile result.json
# cells.json: [{ "id": "16", "x": 0, "y": 0, "w": 0, "h": 0, "hint"?: "0", "allowed"?: "A,B,C,D,X" }, ...] in source-image pixels;
# "hint" marks a cell whose label is already known (used only to seed page templates);
# "allowed" (e.g. "A,B,C,D,X") restricts the labels a cell may take.
# result.json: [{ "id": "16", "label": "B", "score": 0.93, "margin": 0.21, "ink": 312 }, ...]
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string]$Image,
    [Parameter(Mandatory = $true)][string]$Cells,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Labels = 'A,B,C,D,X,0'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;

public static class GlyphMatcher {
    const int Size = 32;

    // Dark-pixel mask of a region, using a threshold halfway between the region's extremes.
    static bool[,] Mask(Bitmap bmp, Rectangle r) {
        r.Intersect(new Rectangle(0, 0, bmp.Width, bmp.Height));
        var lum = new int[r.Width, r.Height];
        int min = 255, max = 0;
        for (int y = 0; y < r.Height; y++) for (int x = 0; x < r.Width; x++) {
            Color c = bmp.GetPixel(r.X + x, r.Y + y);
            int l = (c.R * 299 + c.G * 587 + c.B * 114) / 1000;
            lum[x, y] = l; if (l < min) min = l; if (l > max) max = l;
        }
        // The darkest ink is often a table rule, darker than a faint letter; a threshold above the
        // midpoint keeps thin letter strokes joined (a broken D reads as B).
        int t = max - min < 60 ? -1 : min + (max - min) * 62 / 100;
        var mask = new bool[r.Width, r.Height];
        for (int y = 0; y < r.Height; y++) for (int x = 0; x < r.Width; x++) mask[x, y] = lum[x, y] < t;
        return mask;
    }

    // Keep the largest 8-connected ink component plus components overlapping its box, which
    // drops stray specks and ticks that reviewers leave next to the printed letter.
    // Erase table rules: ink runs far longer than any letter stroke. A letter touching a rule
    // would otherwise merge with it into one component and be discarded along with it.
    static bool[,] EraseRules(bool[,] source) {
        int w = source.GetLength(0), h = source.GetLength(1);
        var m = (bool[,])source.Clone();
        int minH = Math.Max(12, (int)(w * 0.6)), minV = Math.Max(12, (int)(h * 0.85));
        for (int y = 0; y < h; y++) {
            int start = -1;
            for (int x = 0; x <= w; x++) {
                bool on = x < w && source[x, y];
                if (on && start < 0) start = x;
                if (!on && start >= 0) { if (x - start >= minH) for (int i = start; i < x; i++) m[i, y] = false; start = -1; }
            }
        }
        for (int x = 0; x < w; x++) {
            int start = -1;
            for (int y = 0; y <= h; y++) {
                bool on = y < h && source[x, y];
                if (on && start < 0) start = y;
                if (!on && start >= 0) { if (y - start >= minV) for (int i = start; i < y; i++) m[x, i] = false; start = -1; }
            }
        }
        return m;
    }

    static bool[,] MainGlyph(bool[,] input, out int ink) {
        var m = EraseRules(input);
        int w = m.GetLength(0), h = m.GetLength(1);
        var comp = new int[w, h]; var sizes = new List<int> { 0 }; var boxes = new List<int[]> { null };
        int id = 0;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            if (!m[x, y] || comp[x, y] != 0) continue;
            id++; int size = 0; int x0 = x, x1 = x, y0 = y, y1 = y;
            var stack = new Stack<int[]>(); stack.Push(new[] { x, y }); comp[x, y] = id;
            while (stack.Count > 0) {
                var p = stack.Pop(); size++;
                x0 = Math.Min(x0, p[0]); x1 = Math.Max(x1, p[0]); y0 = Math.Min(y0, p[1]); y1 = Math.Max(y1, p[1]);
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = p[0] + dx, ny = p[1] + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h || !m[nx, ny] || comp[nx, ny] != 0) continue;
                    comp[nx, ny] = id; stack.Push(new[] { nx, ny });
                }
            }
            sizes.Add(size); boxes.Add(new[] { x0, y0, x1, y1 });
        }
        ink = 0;
        var result = new bool[w, h];
        if (id == 0) return result;
        // Table borders are long thin strokes or span the crop; they are never the letter.
        Func<int, bool> isRule = i => {
            var r = boxes[i]; int bw = r[2] - r[0] + 1, bh = r[3] - r[1] + 1;
            return bw > 6 * bh || bh > 6 * bw || bw > w * 0.8 || bh > h * 0.9;
        };
        // Cells are cut taller than a row so a slightly misplaced row still holds its whole letter;
        // letters from the neighbouring rows are then clipped by the edge, so prefer whole glyphs.
        Func<int, bool> clipped = i => { var r = boxes[i]; return r[1] == 0 || r[3] == h - 1 || r[0] == 0 || r[2] == w - 1; };
        int best = 0;
        for (int pass = 0; pass < 2 && best == 0; pass++)
            for (int i = 1; i <= id; i++)
                if (!isRule(i) && sizes[i] >= 12 && (pass == 1 || !clipped(i)) && (best == 0 || sizes[i] > sizes[best])) best = i;
        if (best == 0) return result;
        var b = boxes[best];
        for (int i = 1; i <= id; i++) {
            var o = boxes[i];
            bool overlaps = o[0] <= b[2] && o[2] >= b[0] && o[1] <= b[3] && o[3] >= b[1];
            if (i != best && (!overlaps || sizes[i] < 4 || isRule(i))) continue;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (comp[x, y] == i) { result[x, y] = true; ink++; }
        }
        return result;
    }

    // Crop to the ink box and resample to a Size x Size grid of ink coverage (0..1).
    static double[] Normalize(bool[,] m) {
        int w = m.GetLength(0), h = m.GetLength(1), x0 = w, x1 = -1, y0 = h, y1 = -1;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (m[x, y]) { x0 = Math.Min(x0, x); x1 = Math.Max(x1, x); y0 = Math.Min(y0, y); y1 = Math.Max(y1, y); }
        var v = new double[Size * Size];
        if (x1 < 0) return v;
        // Preserve aspect ratio so "0" and "D" do not collapse into the same square.
        int bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.Max(bw, bh);
        int ox = x0 - (side - bw) / 2, oy = y0 - (side - bh) / 2;
        for (int gy = 0; gy < Size; gy++) for (int gx = 0; gx < Size; gx++) {
            int sx0 = ox + gx * side / Size, sx1 = Math.Max(sx0 + 1, ox + (gx + 1) * side / Size);
            int sy0 = oy + gy * side / Size, sy1 = Math.Max(sy0 + 1, oy + (gy + 1) * side / Size);
            int on = 0, all = 0;
            for (int sy = sy0; sy < sy1; sy++) for (int sx = sx0; sx < sx1; sx++) { all++; if (sx >= 0 && sy >= 0 && sx < w && sy < h && m[sx, sy]) on++; }
            v[gy * Size + gx] = all == 0 ? 0 : (double)on / all;
        }
        return v;
    }

    static double Similarity(double[] a, double[] b) {
        double ma = 0, mb = 0; for (int i = 0; i < a.Length; i++) { ma += a[i]; mb += b[i]; }
        ma /= a.Length; mb /= b.Length;
        double num = 0, da = 0, db = 0;
        for (int i = 0; i < a.Length; i++) { double x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
        return da == 0 || db == 0 ? 0 : num / Math.Sqrt(da * db);
    }

    static List<KeyValuePair<string, double[]>> Templates(string[] labels) {
        var list = new List<KeyValuePair<string, double[]>>();
        foreach (var fontName in new[] { "Calibri", "Arial", "Segoe UI", "Times New Roman" })
        foreach (var style in new[] { FontStyle.Regular, FontStyle.Bold })
        foreach (var label in labels) {
            using (var bmp = new Bitmap(96, 96))
            using (var g = Graphics.FromImage(bmp))
            using (var font = new Font(fontName, 48, style, GraphicsUnit.Pixel)) {
                g.Clear(Color.White);
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                g.DrawString(label, font, Brushes.Black, 12, 8);
                int ink;
                list.Add(new KeyValuePair<string, double[]>(label, Normalize(MainGlyph(Mask(bmp, new Rectangle(0, 0, 96, 96)), out ink))));
            }
        }
        return list;
    }

    static void Rank(double[] v, List<KeyValuePair<string, double[]>> templates, string allowed, out string top, out double topScore, out double second) {
        var best = new Dictionary<string, double>();
        var permitted = string.IsNullOrEmpty(allowed) ? null : new HashSet<string>(allowed.Split(','));
        foreach (var t in templates) {
            if (permitted != null && !permitted.Contains(t.Key)) continue;
            double s = Similarity(v, t.Value);
            double current;
            if (!best.TryGetValue(t.Key, out current) || s > current) best[t.Key] = s;
        }
        top = "?"; topScore = -1; second = -1;
        foreach (var kv in best) {
            if (kv.Value > topScore) { second = topScore; topScore = kv.Value; top = kv.Key; }
            else if (kv.Value > second) second = kv.Value;
        }
    }

    // Pass 1 matches rendered font letters. Cells that pass 1 is sure about (plus any cell whose
    // label the caller already knows, e.g. unused rows printed as "0") then become templates cut
    // from this very scan, and pass 2 re-ranks every cell against them. Same printer, same font,
    // same blur: pass 2 separates look-alikes such as D and 0 far better than generic fonts.
    public static string[] Classify(string imagePath, int[][] rects, string[] hints, string[] allowed, string[] labels) {
        var fontTemplates = Templates(labels);
        var vectors = new double[rects.Length][];
        var inks = new int[rects.Length];
        using (var bmp = new Bitmap(imagePath)) {
            for (int i = 0; i < rects.Length; i++) {
                var r = rects[i];
                int ink;
                vectors[i] = Normalize(MainGlyph(Mask(bmp, new Rectangle(r[0], r[1], r[2], r[3])), out ink));
                inks[i] = ink;
            }
        }
        var pageTemplates = new List<KeyValuePair<string, double[]>>();
        var perLabel = new Dictionary<string, int>();
        for (int i = 0; i < rects.Length; i++) {
            if (inks[i] < 20) continue;
            string label = hints[i];
            if (string.IsNullOrEmpty(label)) {
                string top; double score, second;
                Rank(vectors[i], fontTemplates, allowed[i], out top, out score, out second);
                if (score < 0.7 || score - second < 0.15) continue;
                label = top;
            }
            int count; perLabel.TryGetValue(label, out count);
            if (count >= 12) continue;
            perLabel[label] = count + 1;
            pageTemplates.Add(new KeyValuePair<string, double[]>(label, vectors[i]));
        }
        // Labels with too few confident samples keep their font templates as a fallback.
        var templates = new List<KeyValuePair<string, double[]>>(pageTemplates);
        foreach (var t in fontTemplates) { int count; perLabel.TryGetValue(t.Key, out count); if (count < 2) templates.Add(t); }

        var output = new string[rects.Length];
        for (int i = 0; i < rects.Length; i++) {
            string top; double score, second;
            if (inks[i] < 20) { top = "?"; score = 0; second = 0; }
            else {
                // Exclude the cell's own vector so it cannot vote for itself.
                var others = templates.FindAll(t => !object.ReferenceEquals(t.Value, vectors[i]));
                Rank(vectors[i], others, allowed[i], out top, out score, out second);
            }
            output[i] = string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}	{1:F4}	{2:F4}	{3}", top, score, score - second, inks[i]);
        }
        return output;
    }
}
'@

$parsed = ConvertFrom-Json (Get-Content -Raw (Resolve-Path $Cells).Path)
$items = @($parsed)
$rects = [int[][]]@($items | ForEach-Object { , [int[]]@([int]$_.x, [int]$_.y, [int]$_.w, [int]$_.h) })
$hints = [string[]]@($items | ForEach-Object { if ($_.hint) { [string]$_.hint } else { '' } })
$allowed = [string[]]@($items | ForEach-Object { if ($_.allowed) { [string]$_.allowed } else { '' } })
$results = [GlyphMatcher]::Classify((Resolve-Path $Image).Path, $rects, $hints, $allowed, $Labels.Split(','))
$out = for ($i = 0; $i -lt $items.Count; $i += 1) {
    $parts = $results[$i].Split("`t")
    [pscustomobject]@{ id = [string]$items[$i].id; label = $parts[0]; score = [double]$parts[1]; margin = [double]$parts[2]; ink = [int]$parts[3] }
}
[System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json @($out) -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
