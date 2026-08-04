#!/usr/bin/env node
const response = await fetch("https://api.parcel.app/external/supported_carriers.json", { redirect: "manual" });
if (!response.ok) throw new Error(`Carrier endpoint returned HTTP ${response.status}`);
const carriers = await response.json();
for (const code of ["fedex", "ups", "usps", "pholder"]) if (typeof carriers[code] !== "string") throw new Error(`Carrier catalog is missing ${code}`);
if (Object.keys(carriers).length < 100) throw new Error("Carrier catalog is unexpectedly small");
console.log(`Public carrier contract OK: ${Object.keys(carriers).length} carriers.`);
