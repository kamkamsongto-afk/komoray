import type { Rect } from "../framing";

// Draws the cut-out speaker from a stacked frame (picture on top, matte below: lib/cutout.ts) on the
// graphics card. Doing this on the computer's processor, pixel by pixel, took too long for each frame
// and the preview stuttered (coach, 9 Nov). The whole frame goes in and the shader picks the right half,
// so Safari's trouble with source rectangles in drawImage (engine.ts) never comes up.
const VERTEX = `
attribute vec2 corner;
varying vec2 place;
void main() {
	place = corner;
	gl_Position = vec4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 place;
uniform sampler2D frame;
uniform vec4 box;
void main() {
	vec2 at = (place - box.xy) / box.zw;
	if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) discard;
	// A hair away from the middle line, so the picture never picks up the matte's top row or the other way.
	vec3 picture = texture2D(frame, vec2(at.x, min(at.y * 0.5, 0.498))).rgb;
	float person = texture2D(frame, vec2(at.x, max(0.5 + at.y * 0.5, 0.502))).r;
	gl_FragColor = vec4(picture * person, person);
}`;

export type PersonPainter = {
	draw: (frame: VideoFrame, rect: Rect, outWidth: number) => boolean; // false: draw it another way
	clear: () => void;
};

function compile(gl: WebGLRenderingContext, kind: number, source: string) {
	const shader = gl.createShader(kind);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

// Can this browser hand a VideoFrame to the graphics card? Tried on a canvas of its own: a canvas that
// has been given to WebGL can't go back to the slower drawing.
function canUpload(frame: VideoFrame) {
	try {
		const gl = document.createElement("canvas").getContext("webgl");
		if (!gl) return false;
		gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
		const fine = gl.getError() === gl.NO_ERROR;
		gl.getExtension("WEBGL_lose_context")?.loseContext();
		return fine;
	} catch {
		return false;
	}
}

// null: this browser can't, the engine falls back to its slower drawing.
export function personPainter(canvas: HTMLCanvasElement, sample: VideoFrame): PersonPainter | null {
	if (!canUpload(sample)) return null;
	const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
	if (!gl) return null;
	const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
	const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
	const program = gl.createProgram();
	if (!vertex || !fragment || !program) return null;
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
	gl.useProgram(program);

	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
	const corner = gl.getAttribLocation(program, "corner");
	gl.enableVertexAttribArray(corner);
	gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

	gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	const box = gl.getUniformLocation(program, "box");

	return {
		draw(frame, rect, outWidth) {
			if (gl.isContextLost()) return false;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const w = Math.round(canvas.clientWidth * dpr);
			const h = Math.round(canvas.clientHeight * dpr);
			if (!w || !h) return true;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
			const k = w / outWidth;
			gl.uniform4f(box, rect.x / outWidth, (rect.y * k) / h, rect.w / outWidth, (rect.h * k) / h);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			return true;
		},
		clear() {
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
		},
	};
}
