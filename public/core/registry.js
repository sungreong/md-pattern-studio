export class TemplateRegistry {
  constructor() {
    this.sectionTemplates = new Map();
    this.tablePresets = new Map();
    this.imagePresets = new Map();
    this.editorSnippets = new Map();
  }

  registerSectionTemplate(definition) {
    if (!definition?.name || typeof definition.render !== 'function') {
      throw new Error('Section template requires name and render function');
    }
    this.sectionTemplates.set(definition.name, definition);
  }

  registerTablePreset(definition) {
    if (!definition?.name) {
      throw new Error('Table preset requires a name');
    }
    this.tablePresets.set(definition.name, definition);
  }

  registerImagePreset(definition) {
    if (!definition?.name) {
      throw new Error('Image preset requires a name');
    }
    this.imagePresets.set(definition.name, definition);
  }

  registerEditorSnippet(definition) {
    if (!definition?.name) {
      throw new Error('Editor snippet requires a name');
    }
    this.editorSnippets.set(definition.name, definition);
  }

  getSectionTemplate(name) {
    return this.sectionTemplates.get(name);
  }

  getTablePreset(name) {
    return this.tablePresets.get(name);
  }

  getImagePreset(name) {
    return this.imagePresets.get(name);
  }

  getEditorSnippet(name) {
    return this.editorSnippets.get(name);
  }

  listSectionTemplates() {
    return Array.from(this.sectionTemplates.values());
  }

  listTablePresets() {
    return Array.from(this.tablePresets.values());
  }

  listImagePresets() {
    return Array.from(this.imagePresets.values());
  }

  listEditorSnippets() {
    return Array.from(this.editorSnippets.values());
  }
}
