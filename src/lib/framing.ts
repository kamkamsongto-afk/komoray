// Where the picture sits in the 9:16 final video, piece by piece. A wider (landscape) video is
// cropped around the speaker's face instead of its middle, and Auto zoom grows the picture around
// the face. Faces come from faces.json, found by Modal in the preview copy (detect_faces in
// render.py). Same sums as frame_piece in render.py: change one, change the other.
import { WIDTH, HEIGHT, ZOOM_ORIGIN } from "./timeline";

// Face found every half second: [source seconds, centre x, centre y, width], all but time 0..1 of the picture.
export type Faces = { width: number; height: number; faces: [number, number, number, number][] };
export type Focus = { x: number; y: number };
// Where the whole source picture is drawn, in px of the 1080x1920 final video.
export type Rect = { x: number; y: number; w: number; h: number };

const FACE_HEIGHT = 0.4; // a face is placed this far down the frame when there's room to move
const EDGE = 0.15; // zoom never centres closer than this to an edge

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)];
};

// The face to frame for source seconds [start, end]: the middle of the faces seen then, else of
// all faces in the video (the speaker rarely moves far), else none.
export function focusFor(faces: Faces | null, start: number, end: number): Focus | null {
	if (!faces?.faces.length) return null;
	const inside = faces.faces.filter(([t]) => t >= start && t <= end);
	const pick = inside.length ? inside : faces.faces;
	return { x: median(pick.map((f) => f[1])), y: median(pick.map((f) => f[2])) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// aspect = source width / height, zoom = Auto zoom for this piece (1 = none).
export function framePiece(aspect: number, focus: Focus | null, zoom: number): Rect {
	// Cover the frame (like CSS object-fit: cover)...
	const w0 = Math.max(WIDTH, HEIGHT * aspect);
	const h0 = w0 / aspect;
	// ...cropped around the face (or the middle when there is none)...
	const fx = focus?.x ?? 0.5;
	const fy = focus?.y ?? 0.5;
	const cx = clamp(fx * w0 - WIDTH / 2, 0, w0 - WIDTH);
	const cy = clamp(fy * h0 - (focus ? FACE_HEIGHT : 0.5) * HEIGHT, 0, h0 - HEIGHT);
	// ...and zoomed around the face (or a little above the middle).
	const ox = focus ? clamp((fx * w0 - cx) / WIDTH, EDGE, 1 - EDGE) * WIDTH : ZOOM_ORIGIN.x * WIDTH;
	const oy = focus ? clamp((fy * h0 - cy) / HEIGHT, EDGE, 1 - EDGE) * HEIGHT : ZOOM_ORIGIN.y * HEIGHT;
	return { x: -(cx * zoom + ox * (zoom - 1)), y: -(cy * zoom + oy * (zoom - 1)), w: w0 * zoom, h: h0 * zoom };
}
