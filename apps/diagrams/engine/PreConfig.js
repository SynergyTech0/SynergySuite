/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
// Synergy Diagrams: no export or PlantUML server. With stealth=1 the editor exports PNG, SVG,
// HTML and XML in the browser and turns PDF into the browser's print dialog.
window.EXPORT_URL = 'REPLACE_WITH_YOUR_IMAGE_SERVER';
window.PLANT_URL = 'REPLACE_WITH_YOUR_PLANTUML_SERVER';
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
// The suite page sends its settings through the embed protocol's configure message instead.
window.DRAWIO_CONFIG = null;
urlParams['sync'] = 'manual';
