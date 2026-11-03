import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
	...coreWebVitals,
	...typescript,
	{ ignores: [".next/**", ".open-next/**", "cloudflare-env.d.ts"] },
	// Warnings, not errors: we read browser-only things (saved settings, the address) in effects on purpose,
	// so the first paint matches the server's. Worth a look when touching that code, not worth failing over.
	{ rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn", "react-hooks/purity": "warn" } },
];

export default eslintConfig;
