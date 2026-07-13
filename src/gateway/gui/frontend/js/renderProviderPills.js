function renderProviderPills() {
      var providers = [
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'groq', label: 'Groq' },
        { value: 'google', label: 'Google' },
        { value: 'ollama', label: 'Ollama' },
      ];
      return providers.map(function(p) {
        var sel = state.settingsProvider === p.value;
        var btnClass = sel 
          ? 'bg-primary text-on-primary font-semibold shadow-sm'
          : 'bg-white text-on-surface-variant hover:bg-surface-container-high border border-outline-variant transition-colors';
        return '<button onclick="selectProvider(\'' + p.value + '\')" class="px-4 py-1.5 rounded-full font-label-sm text-label-sm font-semibold shadow-sm ' + btnClass + '">' + p.label + '</button>';
      }).join('');
    }