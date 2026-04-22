#!/usr/bin/env node

/**
 * Wogi Flow - Figma Component Extractor
 *
 * Parses Figma MCP output and extracts atomic components
 * with their CSS properties, structure, and relationships.
 *
 * Usage:
 *   flow figma extract <figma-data.json>   # Extract from file
 *   flow figma extract --stdin             # Read MCP output from stdin
 */

const fs = require('node:fs');
const _path = require('node:path');

// ============================================================
// Figma Node Parser
// ============================================================

class FigmaExtractor {
  constructor() {
    this.components = [];
    this.tokens = {
      colors: new Map(),
      spacing: new Map(),
      typography: new Map(),
      radius: new Map()
    };
  }

  /**
   * Parse the raw Figma MCP response
   */
  parse(figmaData) {
    if (typeof figmaData === 'string') {
      try {
        figmaData = JSON.parse(figmaData);
      } catch (_err) {
        console.error('Failed to parse Figma data as JSON');
        return { components: [], tokens: {} };
      }
    }

    // Reset state
    this.components = [];
    this.tokens = {
      colors: new Map(),
      spacing: new Map(),
      typography: new Map(),
      radius: new Map()
    };

    // Handle different Figma MCP response structures
    if (figmaData.nodes) {
      this.parseNodes(figmaData.nodes);
    } else if (figmaData.document) {
      this.parseNode(figmaData.document);
    } else if (figmaData.children) {
      figmaData.children.forEach(child => this.parseNode(child));
    } else if (figmaData.result) {
      // Handle wrapped response
      return this.parse(figmaData.result);
    } else if (Array.isArray(figmaData)) {
      figmaData.forEach(item => this.parseNode(item));
    } else {
      // Try to parse as a single node
      this.parseNode(figmaData);
    }

    // Build component hierarchy
    this.buildHierarchy();

    return {
      components: this.components,
      tokens: {
        colors: Object.fromEntries(this.tokens.colors),
        spacing: Object.fromEntries(this.tokens.spacing),
        typography: Object.fromEntries(this.tokens.typography),
        radius: Object.fromEntries(this.tokens.radius)
      }
    };
  }

  parseNodes(nodes, parent = null) {
    for (const [_nodeId, nodeData] of Object.entries(nodes)) {
      const node = nodeData.document || nodeData;
      this.parseNode(node, parent);
    }
  }

  parseNode(node, parent = null) {
    if (!node || !node.type) return null;

    const component = {
      id: node.id || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: node.name || 'Unnamed',
      type: this.classifyNodeType(node),
      figmaType: node.type,
      parentId: parent?.id || null,
      children: [],

      // Visual properties
      css: {
        colors: [],
        spacing: [],
        typography: [],
        radius: [],
        sizing: [],
        layout: []
      },

      // Structure info
      structure: {
        childCount: 0,
        depth: 0,
        hasText: false,
        hasImage: false,
        hasIcon: false
      },

      // Figma-specific
      figma: {
        componentId: node.componentId || null,
        isInstance: node.type === 'INSTANCE',
        isComponent: node.type === 'COMPONENT' || node.type === 'COMPONENT_SET',
        variantProperties: node.variantProperties || null
      }
    };

    // Extract visual properties
    this.extractVisualProperties(node, component);

    // Process children recursively
    if (node.children && node.children.length > 0) {
      component.structure.childCount = node.children.length;

      node.children.forEach(child => {
        const childComponent = this.parseNode(child, component);
        if (childComponent) {
          component.children.push(childComponent.id);
        }
      });
    }

    // Check content types
    if (node.type === 'TEXT') {
      component.structure.hasText = true;
      component.textContent = node.characters || '';
    }
    if (node.type === 'VECTOR' || (node.name && node.name.toLowerCase().includes('icon'))) {
      component.structure.hasIcon = true;
    }
    if (node.type === 'RECTANGLE' && node.fills?.some(f => f.type === 'IMAGE')) {
      component.structure.hasImage = true;
    }

    this.components.push(component);
    return component;
  }

  classifyNodeType(node) {
    const type = node.type;
    const childCount = node.children?.length || 0;
    const _name = (node.name || '').toLowerCase();

    // Explicit component types from Figma
    if (type === 'COMPONENT' || type === 'INSTANCE') {
      if (childCount <= 2) return 'atom';
      if (childCount <= 5) return 'molecule';
      return 'organism';
    }

    // Basic elements are atoms
    if (['TEXT', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].includes(type)) {
      return 'atom';
    }

    // Rectangles might be atoms or containers
    if (type === 'RECTANGLE') {
      return 'atom';
    }

    // Frames and groups
    if (type === 'FRAME' || type === 'GROUP' || type === 'SECTION') {
      if (childCount === 0) return 'atom';
      if (childCount <= 3) return 'molecule';
      if (childCount <= 8) return 'organism';
      return 'template';
    }

    return 'unknown';
  }

  extractVisualProperties(node, component) {
    // Colors (fills)
    if (node.fills && Array.isArray(node.fills)) {
      node.fills.forEach(fill => {
        if (fill.type === 'SOLID' && fill.color) {
          const color = this.rgbToHex(fill.color);
          component.css.colors.push({
            property: 'background',
            value: color,
            opacity: fill.opacity ?? 1
          });
          this.tokens.colors.set(color, color);
        } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') {
          component.css.colors.push({
            property: 'background',
            value: 'gradient',
            type: fill.type
          });
        }
      });
    }

    // Strokes (borders)
    if (node.strokes && Array.isArray(node.strokes)) {
      node.strokes.forEach(stroke => {
        if (stroke.type === 'SOLID' && stroke.color) {
          const color = this.rgbToHex(stroke.color);
          component.css.colors.push({
            property: 'border',
            value: color
          });
        }
      });

      if (node.strokeWeight) {
        component.css.sizing.push({
          property: 'borderWidth',
          value: `${node.strokeWeight}px`
        });
      }
    }

    // Typography (for text nodes)
    if (node.style) {
      const style = node.style;

      if (style.fontFamily) {
        component.css.typography.push({
          property: 'fontFamily',
          value: style.fontFamily
        });
      }

      if (style.fontSize) {
        component.css.typography.push({
          property: 'fontSize',
          value: `${style.fontSize}px`
        });
        this.tokens.typography.set(`font-${style.fontSize}`, `${style.fontSize}px`);
      }

      if (style.fontWeight) {
        component.css.typography.push({
          property: 'fontWeight',
          value: style.fontWeight
        });
      }

      if (style.lineHeightPx) {
        component.css.typography.push({
          property: 'lineHeight',
          value: `${style.lineHeightPx}px`
        });
      }

      if (style.letterSpacing) {
        component.css.typography.push({
          property: 'letterSpacing',
          value: `${style.letterSpacing}px`
        });
      }

      if (style.textAlignHorizontal) {
        component.css.typography.push({
          property: 'textAlign',
          value: style.textAlignHorizontal.toLowerCase()
        });
      }
    }

    // Spacing (padding/margins from auto-layout)
    if (node.paddingLeft !== undefined || node.paddingTop !== undefined) {
      const padding = {
        top: node.paddingTop || 0,
        right: node.paddingRight || 0,
        bottom: node.paddingBottom || 0,
        left: node.paddingLeft || 0
      };

      component.css.spacing.push({
        property: 'padding',
        value: padding,
        shorthand: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`
      });

      // Track unique spacing values
      Object.values(padding).forEach(v => {
        if (v > 0) this.tokens.spacing.set(`spacing-${v}`, `${v}px`);
      });
    }

    if (node.itemSpacing !== undefined) {
      component.css.spacing.push({
        property: 'gap',
        value: `${node.itemSpacing}px`
      });
      this.tokens.spacing.set(`gap-${node.itemSpacing}`, `${node.itemSpacing}px`);
    }

    // Border radius
    if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
      component.css.radius.push({
        property: 'borderRadius',
        value: `${node.cornerRadius}px`
      });
      this.tokens.radius.set(`radius-${node.cornerRadius}`, `${node.cornerRadius}px`);
    }

    // Individual corner radii
    if (node.rectangleCornerRadii && Array.isArray(node.rectangleCornerRadii)) {
      const radii = node.rectangleCornerRadii;
      if (radii.some(r => r > 0)) {
        component.css.radius.push({
          property: 'borderRadius',
          value: radii.map(r => `${r}px`).join(' ')
        });
      }
    }

    // Sizing
    if (node.absoluteBoundingBox) {
      const box = node.absoluteBoundingBox;
      component.css.sizing.push({
        property: 'width',
        value: `${Math.round(box.width)}px`
      });
      component.css.sizing.push({
        property: 'height',
        value: `${Math.round(box.height)}px`
      });
    } else if (node.size) {
      component.css.sizing.push({
        property: 'width',
        value: `${Math.round(node.size.x)}px`
      });
      component.css.sizing.push({
        property: 'height',
        value: `${Math.round(node.size.y)}px`
      });
    }

    // Layout mode (auto-layout)
    if (node.layoutMode) {
      component.css.layout.push({
        property: 'display',
        value: 'flex'
      });
      component.css.layout.push({
        property: 'flexDirection',
        value: node.layoutMode === 'VERTICAL' ? 'column' : 'row'
      });
    }

    if (node.primaryAxisAlignItems) {
      component.css.layout.push({
        property: 'justifyContent',
        value: this.mapAlignment(node.primaryAxisAlignItems)
      });
    }

    if (node.counterAxisAlignItems) {
      component.css.layout.push({
        property: 'alignItems',
        value: this.mapAlignment(node.counterAxisAlignItems)
      });
    }

    // Effects (shadows, blur)
    if (node.effects && Array.isArray(node.effects)) {
      node.effects.forEach(effect => {
        if (effect.type === 'DROP_SHADOW' && effect.visible !== false) {
          const color = effect.color ? this.rgbaToString(effect.color) : 'rgba(0,0,0,0.25)';
          component.css.colors.push({
            property: 'boxShadow',
            value: `${effect.offset?.x || 0}px ${effect.offset?.y || 4}px ${effect.radius || 8}px ${color}`
          });
        }
      });
    }
  }

  rgbToHex(color) {
    const r = Math.round((color.r || 0) * 255);
    const g = Math.round((color.g || 0) * 255);
    const b = Math.round((color.b || 0) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  }

  rgbaToString(color) {
    const r = Math.round((color.r || 0) * 255);
    const g = Math.round((color.g || 0) * 255);
    const b = Math.round((color.b || 0) * 255);
    const a = color.a ?? 1;
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  }

  mapAlignment(figmaAlignment) {
    const map = {
      'MIN': 'flex-start',
      'CENTER': 'center',
      'MAX': 'flex-end',
      'SPACE_BETWEEN': 'space-between',
      'BASELINE': 'baseline'
    };
    return map[figmaAlignment] || (figmaAlignment || '').toLowerCase();
  }

  buildHierarchy() {
    const depthMap = new Map();

    const calculateDepth = (component, depth = 0) => {
      depthMap.set(component.id, depth);
      component.structure.depth = depth;

      component.children.forEach(childId => {
        const child = this.components.find(c => c.id === childId);
        if (child) {
          calculateDepth(child, depth + 1);
        }
      });
    };

    // Find root components (no parent)
    const roots = this.components.filter(c => !c.parentId);
    roots.forEach(root => calculateDepth(root));
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, input, ..._args] = process.argv;

  const extractor = new FigmaExtractor();

  if (input === '--stdin') {
    // Read from stdin
    let data = '';
    process.stdin.setEncoding('utf8');

    for await (const chunk of process.stdin) {
      data += chunk;
    }

    const result = extractor.parse(data);
    console.log(JSON.stringify(result, null, 2));

  } else if (input && fs.existsSync(input)) {
    // Read from file
    const data = fs.readFileSync(input, 'utf-8');
    const result = extractor.parse(data);
    console.log(JSON.stringify(result, null, 2));

  } else if (input) {
    console.error(`File not found: ${input}`);
    process.exit(1);

  } else {
    console.log(`
Wogi Flow - Figma Component Extractor

Usage:
  flow figma extract <figma-data.json>  Parse a saved Figma MCP response
  flow figma extract --stdin            Read Figma MCP output from stdin

Example:
  cat figma-response.json | ./scripts/flow-figma-extract.js --stdin
  ./scripts/flow-figma-extract.js design-data.json > extracted.json
    `);
  }
}

module.exports = { FigmaExtractor };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
