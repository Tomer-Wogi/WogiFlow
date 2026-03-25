/**
 * Long Input Processing - Constants and Pattern Definitions
 *
 * Pure data constants extracted from flow-long-input.js.
 * Contains regex patterns, keyword lists, template definitions,
 * and configuration objects used across the long input pipeline.
 */

// ============================================
// Pass 2: Statement Association Constants
// ============================================

/**
 * Filler words and phrases to skip
 */
const FILLER_PATTERNS = [
  /^(um|uh|er|ah|like|you know|so|anyway|basically|actually|literally|right\??)$/i,
  /^(okay|ok|got it|makes sense|sure|yeah|yes|no|alright|right)$/i,
  /^(hi|hello|hey|thanks|thank you|bye|goodbye)(\s+everyone|\s+all)?$/i,
  /^(can you hear me|let me share|one moment|hold on).*$/i,
  /^(that's (a )?good (point|idea)|i agree|exactly|absolutely)$/i,
  /^(let's move on|moving on|anyway|so yeah|alright then)$/i
];

/**
 * Requirement signal patterns
 */
const REQUIREMENT_PATTERNS = [
  /should\s+(be|have|show|display|allow|support|include)/i,
  /must\s+(be|have|show|display|allow|support|include)/i,
  /need(s)?\s+(to|a|the)/i,
  /add\s+(a|the|some)/i,
  /create\s+(a|the|some)/i,
  /implement/i,
  /when\s+.+\s+then/i,
  /if\s+.+\s+(should|must|will)/i
];

// ============================================
// Pass 3: Orphan Check Constants
// ============================================

/**
 * Synonym/related term mappings for semantic expansion
 */
const SEMANTIC_EXPANSIONS = {
  'login': ['sign in', 'signin', 'authentication', 'auth', 'credentials'],
  'logout': ['sign out', 'signout', 'log out'],
  'user': ['account', 'profile', 'member'],
  'button': ['btn', 'click', 'action'],
  'form': ['input', 'field', 'submit'],
  'modal': ['dialog', 'popup', 'overlay'],
  'table': ['grid', 'list', 'data'],
  'dashboard': ['home', 'overview', 'summary'],
  'settings': ['preferences', 'config', 'options'],
  'notification': ['alert', 'message', 'toast'],
  'search': ['find', 'filter', 'query'],
  'navigation': ['nav', 'menu', 'sidebar'],
  'error': ['fail', 'invalid', 'wrong'],
  'save': ['store', 'persist', 'update'],
  'delete': ['remove', 'clear', 'destroy']
};

// ============================================
// Pass 4: Contradiction Resolution Constants
// ============================================

/**
 * Correction phrase patterns for auto-resolution
 */
const CORRECTION_PATTERNS = [
  { pattern: /^actually[,\s]/i, name: 'actually', weight: 0.3 },
  { pattern: /^no[,\s]/i, name: 'no', weight: 0.25 },
  { pattern: /^wait[,\s]/i, name: 'wait', weight: 0.2 },
  { pattern: /^instead[,\s]/i, name: 'instead', weight: 0.3 },
  { pattern: /scratch that/i, name: 'scratch_that', weight: 0.35 },
  { pattern: /forget that/i, name: 'forget_that', weight: 0.35 },
  { pattern: /i meant/i, name: 'i_meant', weight: 0.3 },
  { pattern: /let me rephrase/i, name: 'rephrase', weight: 0.25 },
  { pattern: /i changed my mind/i, name: 'changed_mind', weight: 0.4 },
  { pattern: /on second thought/i, name: 'second_thought', weight: 0.35 },
  { pattern: /not (\w+)[,\s]+(\w+)/i, name: 'not_x_y', weight: 0.3 }
];

/**
 * Additive patterns that indicate not a contradiction
 */
const ADDITIVE_PATTERNS = [
  /^also[,\s]/i,
  /as well/i,
  /additionally/i,
  /\band\b/i,
  /\bplus\b/i,
  /\bboth\b/i,
  /\beither\b/i,
  /another option/i,
  /in addition/i
];

// ============================================
// Question Generation Constants (E2-S1)
// ============================================

/**
 * Entity patterns for completeness detection
 */
const ENTITY_PATTERNS = [
  { pattern: /add (?:a |the )?(\w+) table/i, type: 'table', entity: 1, missing: ['columns', 'actions', 'sorting'] },
  { pattern: /add (?:a |the )?(\w+) form/i, type: 'form', entity: 1, missing: ['fields', 'validation', 'submit_action'] },
  { pattern: /add (?:a |the )?(\w+) button/i, type: 'button', entity: 1, missing: ['action', 'confirmation'] },
  { pattern: /add (?:a |the )?(\w+) list/i, type: 'list', entity: 1, missing: ['items', 'actions', 'empty_state'] },
  { pattern: /add (?:a |the )?modal/i, type: 'modal', entity: null, missing: ['content', 'actions', 'trigger'] },
  { pattern: /add (?:a |the )?dropdown/i, type: 'dropdown', entity: null, missing: ['options', 'default', 'action'] },
  { pattern: /add (?:a |the )?search/i, type: 'search', entity: null, missing: ['scope', 'filters'] },
  { pattern: /add (?:a |the )?filter/i, type: 'filter', entity: null, missing: ['criteria', 'defaults'] }
];

/**
 * Vague patterns that need specificity
 */
const VAGUE_PATTERNS = [
  { pattern: /make it (look )?(nice|good|better|pretty)/i, key: 'design', question: 'Any specific design preferences (colors, style, reference sites)?' },
  { pattern: /make it fast(er)?/i, key: 'performance', question: 'Any specific performance targets (e.g., load under 2 seconds)?' },
  { pattern: /add (some )?validation/i, key: 'validation', question: 'Which fields need validation and what rules (required, format, length)?' },
  { pattern: /handle errors?/i, key: 'errors', question: 'How should errors be displayed to users (toast, inline, modal)?' },
  { pattern: /make it secure/i, key: 'security', question: 'Any specific security requirements (authentication method, encryption, audit logging)?' },
  { pattern: /add (some )?notifications?/i, key: 'notifications', question: 'What events should trigger notifications and how (email, in-app, push)?' },
  { pattern: /make it responsive/i, key: 'responsive', question: 'Which breakpoints are priority (mobile-first, desktop-first, specific widths)?' },
  { pattern: /improve (the )?ux/i, key: 'ux', question: 'Any specific UX improvements in mind or pain points to address?' },
  { pattern: /it should be (easy|simple|intuitive)/i, key: 'simplicity', question: 'Can you describe what "easy/simple" means for your users?' }
];

/**
 * Question templates for completeness
 */
const QUESTION_TEMPLATES = {
  table: {
    columns: { question: 'Which columns should the {entity} table display?', examples: ['Name, Email, Date', 'ID, Status, Actions'], priority: 'P1' },
    actions: { question: 'What row actions are needed for {entity}?', examples: ['View, Edit, Delete', 'None (read-only)'], priority: 'P2' },
    sorting: { question: 'Should {entity} table columns be sortable? Which ones?', examples: ['All columns', 'Date only'], priority: 'P3' }
  },
  form: {
    fields: { question: 'What fields should the {entity} form include?', examples: ['Name (required), Email, Phone'], priority: 'P1' },
    validation: { question: 'What validation rules for {entity} form?', examples: ['Email format, required fields'], priority: 'P2' },
    submit_action: { question: 'What happens after {entity} form submission?', examples: ['Show success, redirect, close modal'], priority: 'P2' }
  },
  button: {
    action: { question: 'What should the {entity} button do when clicked?', examples: ['Submit form', 'Open modal', 'Delete item'], priority: 'P1' },
    confirmation: { question: 'Should {entity} action require confirmation?', examples: ['Yes for delete', 'No for save'], priority: 'P3' }
  },
  list: {
    items: { question: 'What information should each {entity} list item show?', examples: ['Title and date', 'Full details'], priority: 'P1' },
    actions: { question: 'What actions for each {entity} list item?', examples: ['Click to expand', 'Edit/Delete buttons'], priority: 'P2' },
    empty_state: { question: 'What to show when {entity} list is empty?', examples: ['"No items" message', 'Create first item CTA'], priority: 'P3' }
  },
  modal: {
    content: { question: 'What content should the modal display?', examples: ['Form', 'Confirmation message', 'Details view'], priority: 'P1' },
    actions: { question: 'What buttons/actions in the modal?', examples: ['Save/Cancel', 'Confirm/Dismiss'], priority: 'P2' },
    trigger: { question: 'What triggers the modal to open?', examples: ['Button click', 'Row selection'], priority: 'P2' }
  },
  dropdown: {
    options: { question: 'What options should the dropdown include?', priority: 'P1' },
    default: { question: 'What should be the default selection?', priority: 'P3' },
    action: { question: 'What happens when a dropdown option is selected?', priority: 'P2' }
  },
  search: {
    scope: { question: 'What should the search cover (which fields/entities)?', examples: ['Name and email', 'All text fields'], priority: 'P1' },
    filters: { question: 'Should search have additional filters?', examples: ['Date range, status', 'None'], priority: 'P3' }
  },
  filter: {
    criteria: { question: 'What filter criteria are needed?', examples: ['Status, date range, category'], priority: 'P1' },
    defaults: { question: 'Should filters have default values?', priority: 'P3' }
  }
};

/**
 * Detail detection patterns
 */
const DETAIL_PATTERNS = {
  columns: /column|field|display|show\s+(the\s+)?\w+/i,
  sorting: /sort(able)?|order\s+by/i,
  actions: /click|button|delete|edit|action/i,
  validation: /valid(ation)?|required|format|pattern|check/i,
  pagination: /page|pagina|per page|\d+\s+items/i,
  fields: /field|input|text\s*box/i
};

// ==========================================================================
// E5-S2: Multi-language Question Templates
// ==========================================================================

/**
 * Question templates by language (E5-S2)
 */
const QUESTION_TEMPLATES_BY_LANGUAGE = {
  en: QUESTION_TEMPLATES, // English uses the default templates

  es: {
    table: {
      columns: { question: '¿Qué columnas debe mostrar la tabla de {entity}?', examples: ['Nombre, Email, Fecha', 'ID, Estado, Acciones'], priority: 'P1' },
      actions: { question: '¿Qué acciones de fila se necesitan para {entity}?', examples: ['Ver, Editar, Eliminar', 'Ninguna (solo lectura)'], priority: 'P2' },
      sorting: { question: '¿Las columnas de la tabla {entity} deben ser ordenables? ¿Cuáles?', examples: ['Todas las columnas', 'Solo fecha'], priority: 'P3' }
    },
    form: {
      fields: { question: '¿Qué campos debe incluir el formulario de {entity}?', examples: ['Nombre (requerido), Email, Teléfono'], priority: 'P1' },
      validation: { question: '¿Qué reglas de validación para el formulario de {entity}?', examples: ['Formato de email, campos requeridos'], priority: 'P2' },
      submit_action: { question: '¿Qué sucede después de enviar el formulario de {entity}?', examples: ['Mostrar éxito, redirigir, cerrar modal'], priority: 'P2' }
    },
    button: {
      action: { question: '¿Qué debe hacer el botón {entity} al hacer clic?', examples: ['Enviar formulario', 'Abrir modal', 'Eliminar elemento'], priority: 'P1' },
      confirmation: { question: '¿La acción de {entity} requiere confirmación?', examples: ['Sí para eliminar', 'No para guardar'], priority: 'P3' }
    },
    list: {
      items: { question: '¿Qué información debe mostrar cada elemento de la lista {entity}?', examples: ['Título y fecha', 'Detalles completos'], priority: 'P1' },
      actions: { question: '¿Qué acciones para cada elemento de la lista {entity}?', examples: ['Clic para expandir', 'Botones Editar/Eliminar'], priority: 'P2' },
      empty_state: { question: '¿Qué mostrar cuando la lista {entity} está vacía?', examples: ['Mensaje "Sin elementos"', 'CTA para crear el primero'], priority: 'P3' }
    },
    modal: {
      content: { question: '¿Qué contenido debe mostrar el modal?', examples: ['Formulario', 'Mensaje de confirmación', 'Vista de detalles'], priority: 'P1' },
      actions: { question: '¿Qué botones/acciones en el modal?', examples: ['Guardar/Cancelar', 'Confirmar/Descartar'], priority: 'P2' }
    },
    dropdown: {
      options: { question: '¿Qué opciones debe incluir el menú desplegable?', priority: 'P1' },
      default: { question: '¿Cuál debe ser la selección predeterminada?', priority: 'P3' }
    },
    search: {
      scope: { question: '¿Qué debe cubrir la búsqueda (qué campos/entidades)?', examples: ['Nombre y email', 'Todos los campos de texto'], priority: 'P1' },
      filters: { question: '¿La búsqueda debe tener filtros adicionales?', examples: ['Rango de fechas, estado', 'Ninguno'], priority: 'P3' }
    },
    filter: {
      criteria: { question: '¿Qué criterios de filtro se necesitan?', examples: ['Estado, rango de fechas, categoría'], priority: 'P1' },
      defaults: { question: '¿Los filtros deben tener valores predeterminados?', priority: 'P3' }
    }
  },

  he: {
    table: {
      columns: { question: 'אילו עמודות צריכה להציג טבלת {entity}?', examples: ['שם, אימייל, תאריך', 'מזהה, סטטוס, פעולות'], priority: 'P1' },
      actions: { question: 'אילו פעולות שורה נדרשות עבור {entity}?', examples: ['צפייה, עריכה, מחיקה', 'ללא (קריאה בלבד)'], priority: 'P2' },
      sorting: { question: 'האם עמודות טבלת {entity} צריכות להיות ניתנות למיון? אילו?', examples: ['כל העמודות', 'רק תאריך'], priority: 'P3' }
    },
    form: {
      fields: { question: 'אילו שדות צריך לכלול טופס {entity}?', examples: ['שם (חובה), אימייל, טלפון'], priority: 'P1' },
      validation: { question: 'אילו כללי אימות עבור טופס {entity}?', examples: ['פורמט אימייל, שדות חובה'], priority: 'P2' },
      submit_action: { question: 'מה קורה אחרי שליחת טופס {entity}?', examples: ['הצגת הצלחה, הפניה, סגירת מודל'], priority: 'P2' }
    },
    button: {
      action: { question: 'מה צריך כפתור {entity} לעשות בלחיצה?', examples: ['שליחת טופס', 'פתיחת מודל', 'מחיקת פריט'], priority: 'P1' },
      confirmation: { question: 'האם פעולת {entity} דורשת אישור?', examples: ['כן למחיקה', 'לא לשמירה'], priority: 'P3' }
    },
    list: {
      items: { question: 'איזה מידע כל פריט ברשימת {entity} צריך להציג?', examples: ['כותרת ותאריך', 'פרטים מלאים'], priority: 'P1' },
      actions: { question: 'אילו פעולות לכל פריט ברשימת {entity}?', examples: ['לחיצה להרחבה', 'כפתורי עריכה/מחיקה'], priority: 'P2' },
      empty_state: { question: 'מה להציג כשרשימת {entity} ריקה?', examples: ['הודעת "אין פריטים"', 'קריאה ליצירת הראשון'], priority: 'P3' }
    },
    modal: {
      content: { question: 'איזה תוכן המודל צריך להציג?', examples: ['טופס', 'הודעת אישור', 'תצוגת פרטים'], priority: 'P1' },
      actions: { question: 'אילו כפתורים/פעולות במודל?', examples: ['שמירה/ביטול', 'אישור/סגירה'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'אילו אפשרויות התפריט הנפתח צריך לכלול?', priority: 'P1' },
      default: { question: 'מה צריכה להיות הבחירה המוגדרת כברירת מחדל?', priority: 'P3' }
    },
    search: {
      scope: { question: 'מה החיפוש צריך לכסות (אילו שדות/ישויות)?', examples: ['שם ואימייל', 'כל שדות הטקסט'], priority: 'P1' },
      filters: { question: 'האם לחיפוש צריכים להיות מסננים נוספים?', examples: ['טווח תאריכים, סטטוס', 'ללא'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'אילו קריטריוני סינון נדרשים?', examples: ['סטטוס, טווח תאריכים, קטגוריה'], priority: 'P1' },
      defaults: { question: 'האם למסננים צריכים להיות ערכי ברירת מחדל?', priority: 'P3' }
    }
  },

  fr: {
    table: {
      columns: { question: 'Quelles colonnes le tableau {entity} doit-il afficher?', examples: ['Nom, Email, Date', 'ID, Statut, Actions'], priority: 'P1' },
      actions: { question: 'Quelles actions de ligne sont nécessaires pour {entity}?', examples: ['Voir, Modifier, Supprimer', 'Aucune (lecture seule)'], priority: 'P2' },
      sorting: { question: 'Les colonnes du tableau {entity} doivent-elles être triables? Lesquelles?', examples: ['Toutes les colonnes', 'Date uniquement'], priority: 'P3' }
    },
    form: {
      fields: { question: 'Quels champs le formulaire {entity} doit-il inclure?', examples: ['Nom (requis), Email, Téléphone'], priority: 'P1' },
      validation: { question: 'Quelles règles de validation pour le formulaire {entity}?', examples: ['Format email, champs requis'], priority: 'P2' },
      submit_action: { question: 'Que se passe-t-il après la soumission du formulaire {entity}?', examples: ['Afficher succès, rediriger, fermer modal'], priority: 'P2' }
    },
    button: {
      action: { question: 'Que doit faire le bouton {entity} au clic?', examples: ['Soumettre le formulaire', 'Ouvrir modal', 'Supprimer élément'], priority: 'P1' },
      confirmation: { question: "L'action {entity} nécessite-t-elle une confirmation?", examples: ['Oui pour supprimer', 'Non pour enregistrer'], priority: 'P3' }
    },
    list: {
      items: { question: 'Quelles informations chaque élément de la liste {entity} doit-il afficher?', examples: ['Titre et date', 'Détails complets'], priority: 'P1' },
      actions: { question: 'Quelles actions pour chaque élément de la liste {entity}?', examples: ['Clic pour développer', 'Boutons Modifier/Supprimer'], priority: 'P2' },
      empty_state: { question: 'Que montrer quand la liste {entity} est vide?', examples: ['Message "Aucun élément"', 'CTA pour créer le premier'], priority: 'P3' }
    },
    modal: {
      content: { question: 'Quel contenu le modal doit-il afficher?', examples: ['Formulaire', 'Message de confirmation', 'Vue détaillée'], priority: 'P1' },
      actions: { question: 'Quels boutons/actions dans le modal?', examples: ['Enregistrer/Annuler', 'Confirmer/Fermer'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'Quelles options le menu déroulant doit-il inclure?', priority: 'P1' },
      default: { question: 'Quelle doit être la sélection par défaut?', priority: 'P3' }
    },
    search: {
      scope: { question: 'Que doit couvrir la recherche (quels champs/entités)?', examples: ['Nom et email', 'Tous les champs texte'], priority: 'P1' },
      filters: { question: 'La recherche doit-elle avoir des filtres supplémentaires?', examples: ['Plage de dates, statut', 'Aucun'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'Quels critères de filtre sont nécessaires?', examples: ['Statut, plage de dates, catégorie'], priority: 'P1' },
      defaults: { question: 'Les filtres doivent-ils avoir des valeurs par défaut?', priority: 'P3' }
    }
  },

  de: {
    table: {
      columns: { question: 'Welche Spalten soll die {entity}-Tabelle anzeigen?', examples: ['Name, E-Mail, Datum', 'ID, Status, Aktionen'], priority: 'P1' },
      actions: { question: 'Welche Zeilenaktionen werden für {entity} benötigt?', examples: ['Anzeigen, Bearbeiten, Löschen', 'Keine (nur lesen)'], priority: 'P2' },
      sorting: { question: 'Sollen die Spalten der {entity}-Tabelle sortierbar sein? Welche?', examples: ['Alle Spalten', 'Nur Datum'], priority: 'P3' }
    },
    form: {
      fields: { question: 'Welche Felder soll das {entity}-Formular enthalten?', examples: ['Name (erforderlich), E-Mail, Telefon'], priority: 'P1' },
      validation: { question: 'Welche Validierungsregeln für das {entity}-Formular?', examples: ['E-Mail-Format, Pflichtfelder'], priority: 'P2' },
      submit_action: { question: 'Was passiert nach dem Absenden des {entity}-Formulars?', examples: ['Erfolg anzeigen, umleiten, Modal schließen'], priority: 'P2' }
    },
    button: {
      action: { question: 'Was soll die {entity}-Schaltfläche beim Klicken tun?', examples: ['Formular absenden', 'Modal öffnen', 'Element löschen'], priority: 'P1' },
      confirmation: { question: 'Erfordert die {entity}-Aktion eine Bestätigung?', examples: ['Ja zum Löschen', 'Nein zum Speichern'], priority: 'P3' }
    },
    list: {
      items: { question: 'Welche Informationen soll jedes Element der {entity}-Liste anzeigen?', examples: ['Titel und Datum', 'Vollständige Details'], priority: 'P1' },
      actions: { question: 'Welche Aktionen für jedes Element der {entity}-Liste?', examples: ['Klicken zum Erweitern', 'Bearbeiten/Löschen-Schaltflächen'], priority: 'P2' },
      empty_state: { question: 'Was anzeigen, wenn die {entity}-Liste leer ist?', examples: ['"Keine Elemente"-Nachricht', 'CTA zum Erstellen des ersten'], priority: 'P3' }
    },
    modal: {
      content: { question: 'Welchen Inhalt soll das Modal anzeigen?', examples: ['Formular', 'Bestätigungsnachricht', 'Detailansicht'], priority: 'P1' },
      actions: { question: 'Welche Schaltflächen/Aktionen im Modal?', examples: ['Speichern/Abbrechen', 'Bestätigen/Schließen'], priority: 'P2' }
    },
    dropdown: {
      options: { question: 'Welche Optionen soll das Dropdown-Menü enthalten?', priority: 'P1' },
      default: { question: 'Was soll die Standardauswahl sein?', priority: 'P3' }
    },
    search: {
      scope: { question: 'Was soll die Suche abdecken (welche Felder/Entitäten)?', examples: ['Name und E-Mail', 'Alle Textfelder'], priority: 'P1' },
      filters: { question: 'Soll die Suche zusätzliche Filter haben?', examples: ['Datumsbereich, Status', 'Keine'], priority: 'P3' }
    },
    filter: {
      criteria: { question: 'Welche Filterkriterien werden benötigt?', examples: ['Status, Datumsbereich, Kategorie'], priority: 'P1' },
      defaults: { question: 'Sollen Filter Standardwerte haben?', priority: 'P3' }
    }
  }
};

// ============================================
// Follow-up Trigger Constants
// ============================================

/**
 * Follow-up trigger patterns
 */
const FOLLOWUP_TRIGGERS = [
  { pattern: /multiple|several|various|different/i, type: 'clarify_list', question: 'Can you list all the {item}?' },
  { pattern: /custom|special|specific/i, type: 'clarify_details', question: 'What are the specific requirements for this?' },
  { pattern: /depends|conditional|if\s+/i, type: 'clarify_conditions', question: 'What conditions determine this?' },
  { pattern: /delete|remove/i, type: 'confirm_destructive', question: 'Should this action require confirmation?' },
  { pattern: /user types?|roles?|permissions?/i, type: 'clarify_permissions', question: 'What are the different user types and their permissions?' },
  { pattern: /later|future|eventually/i, type: 'clarify_timeline', question: 'Is this needed for the initial release or can it be added later?' }
];

// ============================================
// E3-S1: Complexity Detection Constants
// ============================================

/**
 * UI component patterns for complexity analysis
 */
const UI_PATTERNS = [
  { pattern: /\b(table|grid|list)\b/i, type: 'data_display' },
  { pattern: /\b(form|input|field)\b/i, type: 'data_entry' },
  { pattern: /\b(button|link|action)\b/i, type: 'interaction' },
  { pattern: /\b(modal|dialog|popup)\b/i, type: 'overlay' },
  { pattern: /\b(page|screen|view)\b/i, type: 'navigation' },
  { pattern: /\b(menu|nav|sidebar)\b/i, type: 'navigation' },
  { pattern: /\b(card|panel|section)\b/i, type: 'layout' },
  { pattern: /\b(chart|graph|visualization)\b/i, type: 'visualization' }
];

/**
 * Data entity patterns for complexity analysis
 */
const DATA_PATTERNS = [
  { pattern: /\b(user|account|profile)\b/i, type: 'user_entity' },
  { pattern: /\b(product|item|inventory)\b/i, type: 'product_entity' },
  { pattern: /\b(order|transaction|payment)\b/i, type: 'transaction_entity' },
  { pattern: /\b(message|notification|alert)\b/i, type: 'communication' },
  { pattern: /\b(setting|config|preference)\b/i, type: 'configuration' },
  { pattern: /\b(role|permission|access)\b/i, type: 'authorization' }
];

/**
 * Interaction patterns for complexity analysis
 */
const INTERACTION_PATTERNS = [
  { pattern: /\b(create|add|new)\b/i, type: 'create' },
  { pattern: /\b(edit|update|modify)\b/i, type: 'update' },
  { pattern: /\b(delete|remove|archive)\b/i, type: 'delete' },
  { pattern: /\b(view|show|display)\b/i, type: 'read' },
  { pattern: /\b(search|filter|sort)\b/i, type: 'query' },
  { pattern: /\b(import|export|sync)\b/i, type: 'transfer' },
  { pattern: /\b(approve|reject|review)\b/i, type: 'workflow' }
];

/**
 * Complexity level thresholds
 */
const COMPLEXITY_LEVELS = [
  { max: 20, level: 'simple', description: 'Single feature, few requirements', recommended: 'single_story' },
  { max: 40, level: 'low', description: 'Small feature set, clear scope', recommended: 'story_group', storyRange: '2-3' },
  { max: 60, level: 'medium', description: 'Multiple features, some complexity', recommended: 'story_group', storyRange: '4-8' },
  { max: 80, level: 'high', description: 'Complex feature set, many details', recommended: 'epic', storyRange: 'epic with sub-stories' },
  { max: 100, level: 'very_high', description: 'Large system, many interconnections', recommended: 'multiple_epics', storyRange: 'multiple epics' }
];

module.exports = {
  // Pass 2 constants
  FILLER_PATTERNS,
  REQUIREMENT_PATTERNS,
  // Pass 3 constants
  SEMANTIC_EXPANSIONS,
  // Pass 4 constants
  CORRECTION_PATTERNS,
  ADDITIVE_PATTERNS,
  // Question generation constants
  ENTITY_PATTERNS,
  VAGUE_PATTERNS,
  QUESTION_TEMPLATES,
  DETAIL_PATTERNS,
  QUESTION_TEMPLATES_BY_LANGUAGE,
  // Follow-up constants
  FOLLOWUP_TRIGGERS,
  // Complexity constants
  UI_PATTERNS,
  DATA_PATTERNS,
  INTERACTION_PATTERNS,
  COMPLEXITY_LEVELS
};
