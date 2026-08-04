export const CONNECTOR_NAME = "Parcel Delivery Tracking";
export const CONNECTOR_ORIGIN = "https://parcel.amesvt.com";
export const CONNECTOR_ICON_URL = `${CONNECTOR_ORIGIN}/icon.svg`;
export const REMOTE_SERVER_INFO = { name: "parcel_mcp", version: "1.0.0", title: CONNECTOR_NAME, icons: [{ src: CONNECTOR_ICON_URL, mimeType: "image/svg+xml", sizes: ["any"] }] };
export const CONNECTOR_RESOURCE_METADATA = { resource_name: CONNECTOR_NAME, resource_documentation: "https://github.com/oliverames/parcel-mcp-server#readme" };
export const DISCLAIMER = "An independent connector for Parcel. Not affiliated with or endorsed by Parcel or Ivan Pavlov.";
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#3478f6"/><path d="M250 356 512 216l262 140v312L512 808 250 668Z" fill="#fff"/><path d="m250 356 262 148 262-148M512 504v304" fill="none" stroke="#2465e8" stroke-width="44" stroke-linejoin="round"/></svg>`;
