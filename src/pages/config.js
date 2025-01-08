document.addEventListener('DOMContentLoaded', async () => {
  const defaultModel = 'gpt-4o-mini';
  const defaultBaseUrl = 'https://api.openai.com/v1';

  const maxPromptBytes = 8192;
  const customPromptsCounter = document.getElementById('customPromptsCounter');

  const status = document.getElementById('status');

  const profileSelector = document.getElementById('profileSelector');

  // Global options
  const apiKey = document.getElementById('apiKey');
  const debug = document.getElementById('debug');
  const baseUrl = document.getElementById('baseUrl') || defaultBaseUrl;

  // Profile options
  const name = document.getElementById('name');
  const customPrompts = document.getElementById('customPrompts');
  const isDefault = document.getElementById('default');

  // Model-related widgets
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const saveProfileBtn = document.getElementById('save-profile-btn');
  const modelSelect = document.getElementById('model');

  let config;
  let currentProfile;

  function updateCustomPromptsCounter() {
    const encoder = new TextEncoder();
    let byteCount = encoder.encode(customPrompts.value).length;

    if (byteCount > maxPromptBytes) {
      let low = 0;
      let high = customPrompts.value.length;
      let mid;
      while (low < high) {
        mid = Math.floor((low + high) / 2);
        byteCount = encoder.encode(customPrompts.value.substring(0, mid)).length;

        if (byteCount > maxPromptBytes) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }

      customPrompts.value = customPrompts.value.substring(0, high - 1);
      byteCount = encoder.encode(customPrompts.value).length;
    }

    customPromptsCounter.textContent = `${byteCount}/${maxPromptBytes}`;

    // Update the color of the byte counter based on the byte count
    customPromptsCounter.classList.remove('text-danger');
    customPromptsCounter.classList.remove('text-muted');

    if (byteCount >= maxPromptBytes) {
      customPromptsCounter.classList.add('text-danger');
    } else {
      customPromptsCounter.classList.add('text-muted');
    }
  }

  function buildDefaultProfile() {
    return {
      model: defaultModel,
      customPrompts: [],
    };
  }

  function buildDefaultConfig() {
    return {
      apiKey: '',
      baseUrl: '',
      debug: false,
      defaultProfile: 'default',
      profiles: ['default'],
      profile__default: buildDefaultProfile(),
    };
  }

  async function saveConfig() {
    // Global options
    const debug = document.getElementById('debug').getAttribute('aria-checked') === 'true';
    const apiKey = document.getElementById('apiKey').value.trim();
    const baseUrl = document.getElementById('baseUrl').value.trim();

    // Profile options
    const name = document.getElementById('name').value.trim();
    const model = modelSelect.value.trim();
    const customPrompts = document.getElementById('customPrompts').value.split('\n');
    const isDefault = document.getElementById('default').getAttribute('aria-checked') === 'true';

    // Basic validations
    if (apiKey == '') {
      showError('An API key is required. Get one <a href="https://beta.openai.com">here</a>.');
      return;
    }

    if (baseUrl == '') {
      showError('Base URL is required.');
      return;
    }

    if (name == '') {
      showError('Profile name cannot be empty.');
      return;
    }

    const newProfile = {
      model: model,
      customPrompts: customPrompts,
    };

    // The user is changing the current profile's name
    if (currentProfile !== null && name !== currentProfile) {
      config.profiles = config.profiles.filter((profile) => profile !== currentProfile);
      delete config[`profile__${currentProfile}`];
      config.profiles.push(name);
      config[`profile__${name}`] = newProfile;
      currentProfile = name;
    }
    // The user is adding a new profile
    else if (currentProfile === null) {
      currentProfile = name;
      config.profiles.push(name);
      config[`profile__${name}`] = newProfile;
    }
    // The user is updating the current profile
    else {
      config[`profile__${name}`] = newProfile;
    }

    config.debug = debug;
    config.apiKey = apiKey;
    config.baseUrl = baseUrl;

    if (isDefault) {
      config.defaultProfile = name;
    }

    await chrome.storage.sync.set(config);
    await reloadConfig();
    selectProfile(name);

    window.scrollTo(0, 0);
    showSuccess('Settings saved.');
  }

  async function deleteCurrentProfile() {
    if (currentProfile === config.defaultProfile) {
      showError('Cannot delete the default profile.');
      return;
    }

    if (confirm(`Are you sure you want to delete "${currentProfile}"? This cannot be undone.`)) {
      // remove from list of profile names
      config.profiles = config.profiles.filter((profile) => profile !== currentProfile);

      // remove individual profile's config
      delete config[`profile__${currentProfile}`];

      // remove from the ui
      profileSelector.remove(profileSelector.selectedIndex);

      // save the new config
      await chrome.storage.sync.set(config);

      showSuccess(`Profile "${currentProfile}" deleted.`);
      selectProfile(config.defaultProfile);
    }
  }

  async function addNewProfile() {
    const name = prompt('Enter a name for the new profile');

    if (name in config.profiles) {
      showError(`Profile "${name}" already exists.`);
      return;
    }

    // Not an error - the user probably cancelled
    if (name == '' || name == null) {
      return;
    }

    config.profiles.push(name);
    config[`profile__${name}`] = buildDefaultProfile();
    await chrome.storage.sync.set(config);

    addOption(name);

    // omg this is stupid, why do i have to do this?
    profileSelector.value = name;
    const event = new Event('change', { bubbles: true });
    profileSelector.dispatchEvent(event);
  }

  async function reloadConfig() {
    const profileKeys = (await chrome.storage.sync.get('profiles')).profiles.map((name) => `profile__${name}`);
    config = await chrome.storage.sync.get(['apiKey', 'baseUrl', 'defaultProfile', 'debug', 'models', 'profiles', ...profileKeys]);
    console.log('Config', config);

    if (config.profiles === undefined) {
      config.profiles = ['default'];
      config.defaultProfile = 'default';
      config[`profile__default`] = buildDefaultProfile();
    }

    // Update state variables
    currentProfile = config.defaultProfile;

    // Then update the form with global configs
    toggleDebug(!!(config.debug || false));
    apiKey.value = config.apiKey;
    baseUrl.value = config.baseUrl || defaultBaseUrl;

    // Load profiles into the dropdown and select the current profile.
    // Sort the profiles such that the default profile is always first.
    const sortedProfileNames = config.profiles.sort((a, b) => {
      if (a === config.defaultProfile) return -1;
      if (b === config.defaultProfile) return 1;
      return a.localeCompare(b);
    });

    // Clear the current options before we repopulate them
    profileSelector.innerHTML = '';

    // Populate the profile selector dropdown
    sortedProfileNames.forEach(addOption);

    // Populate the model selector dropdown if possible
    if (config.models && config.models.length > 0) {
      populateModelOptions(config.models);
      modelSelect.disabled = false;
    } else {
      modelSelect.disabled = true;
    }

    selectProfile(currentProfile);
  }

  function populateModelOptions(models) {
    // Clear existing options
    modelSelect.innerHTML = '';

    // Populate the models dropdown
    models.forEach((modelName) => {
      const option = new Option(modelName, modelName);
      modelSelect.add(option);
    });
  }

  async function fetchAvailableModels(apiKey, baseUrl) {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
    };

    try {
      const response = await fetch(baseUrl + '/models', {
        method: 'GET',
        headers: headers,
      });

      if (!response.ok) {
        console.error('Error fetching models:', response);
        throw new Error(`Error fetching models: ${response.statusText}`);
      }

      const data = await response.json();

      models = data.data
        // We only want the model IDs
        .map((model) => model.id)
        // Filter out models that are not GPT-3 or GPT-4
        // .filter((model) => model.startsWith('gpt-'))
        // Filter out models matching `-\d\d\d\d`
        .filter((model) => !model.match(/-\d\d\d\d/));

      models.sort();

      return models;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  async function refreshAvailableModels() {
    // Disable the button to prevent multiple clicks
    refreshModelsBtn.disabled = true;
    refreshModelsBtn.textContent = 'Refreshing...';

    // Store the currently selected model
    const currentModel = modelSelect.value;

    try {
      const apiKeyValue = apiKey.value.trim();
      const baseUrlValue = baseUrl.value.trim();

      if (!apiKeyValue) {
        showError('Please enter your OpenAI API key before refreshing models.');
        return;
      }

      if (!baseUrlValue) {
        showError('Please enter your Base URL before refreshing models.');
        return;
      }

      const models = await fetchAvailableModels(apiKeyValue, baseUrlValue);

      if (models.length === 0) {
        showError('No models retrieved. Please check your API key and try again.');
        return;
      }

      // Store models in config
      config.models = models;
      await chrome.storage.sync.set(config);

      // Populate the models dropdown
      populateModelOptions(models);

      // Enable the models select and save button
      modelSelect.disabled = false;
      saveProfileBtn.disabled = false;

      showSuccess('Available models have been refreshed.');

      // Restore the previously selected model... if it still exists.
      if (models.includes(currentModel)) {
        modelSelect.value = currentModel;
      } else {
        modelSelect.value = defaultModel;
      }
    } catch (error) {
      showError(`Failed to refresh models: ${error.message}`);
    } finally {
      refreshModelsBtn.disabled = false;
      refreshModelsBtn.textContent = 'Refresh available models';
    }
  }

  function addOption(name) {
    const option = new Option(name, name);
    option.selected = name == currentProfile;
    profileSelector.add(option);
    return option;
  }

  // Update the form inputs with profile values
  function selectProfile(profile) {
    if (config.profiles.includes(profile)) {
      const data = config[`profile__${profile}`];

      currentProfile = profile;
      profileSelector.value = profile;

      name.value = profile;
      modelSelect.value = data.model || defaultModel;
      customPrompts.value = data.customPrompts.join('\n') || '';
      toggleDefault(profile === config.defaultProfile);

      // Update the byte counter after setting the prompt value
      updateCustomPromptsCounter();

      return;
    }

    showError(`Profile "${profile}" does not exist.`);
  }

  function showStatus(msg, type) {
    const styles = {
      danger: {
        container: 'bg-red-50',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 text-red-500">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>
        </svg>`,
        text: 'text-red-700',
      },
      success: {
        container: 'bg-green-50',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 text-green-500">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
        </svg>`,
        text: 'text-green-700',
      },
    };

    const style = styles[type];
    const alertDiv = document.createElement('div');
    alertDiv.className = `fade-in flex rounded-md p-4 ${style.container}`;
    alertDiv.innerHTML = `
      <div class="flex w-full">
        <div class="flex-shrink-0">
          ${style.icon}
        </div>
        <div class="ml-3 flex-1">
          <p class="text-sm font-medium ${style.text}">${msg}</p>
        </div>
        <div class="pl-3 ml-auto">
          <div class="flex">
            <button type="button" class="inline-flex rounded-md ${style.text} hover:${style.text} focus:outline-none">
              <span class="sr-only">Dismiss</span>
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Add click handler for close button
    const closeButton = alertDiv.querySelector('button');
    closeButton.addEventListener('click', () => alertDiv.remove());

    // Clear previous alerts and add new one
    status.innerHTML = '';
    status.appendChild(alertDiv);
  }

  function showError(msg) {
    showStatus(msg, 'danger');
  }

  function showSuccess(msg) {
    showStatus(msg, 'success');
  }

  // Update form inputs when profile is changed
  profileSelector.addEventListener('change', (e) => {
    selectProfile(e.target.value);
  });

  // Handler to add new profile
  document.getElementById('add-profile-btn').addEventListener('click', async () => {
    await addNewProfile();
  });

  // Handler to delete the current profile
  document.getElementById('delete-profile-btn').addEventListener('click', async () => {
    await deleteCurrentProfile();
  });

  // Form submission handler
  document.getElementById('save-profile-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    await saveConfig();
  });

  // Powers the button that opens the OpenAI API page
  document.getElementById('open-api-keys').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://platform.openai.com/api-keys' });
  });

  // Powers the button that exports the current profile config
  document.getElementById('export-profiles-btn').addEventListener('click', function () {
    if (!config) {
      showStatus('No profiles to export.', 'danger');
      return;
    }

    const profiles = {};
    config.profiles.forEach((name) => {
      profiles[name] = config[`profile__${name}`];
    });

    if (Object.keys(profiles).length === 0) {
      showStatus('No profiles to export.', 'danger');
      return;
    }

    const configStr = JSON.stringify(profiles, null, 2);
    const blob = new Blob([configStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'PageSummarizeProfiles.json';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showSuccess('Profiles exported successfully.');
  });

  // Powers the button that imports the profile config file (part 1)
  document.getElementById('import-profiles-btn').addEventListener('click', function () {
    document.getElementById('import-profiles-file').click(); // Trigger file input
  });

  // Powers the button that imports the profile config file (part 2)
  document.getElementById('import-profiles-file').addEventListener('change', function (event) {
    const fileReader = new FileReader();

    // Once the file is read, import the profiles into the current config
    fileReader.onload = async function () {
      try {
        const importedProfiles = JSON.parse(fileReader.result);
        const importedProfileNames = Object.keys(importedProfiles);

        config.profiles = [...new Set([...config.profiles, ...importedProfileNames])];

        importedProfileNames.forEach((name) => {
          config[`profile__${name}`] = importedProfiles[name];
        });

        await chrome.storage.sync.set(config);
        await reloadConfig();

        showSuccess('Profiles imported successfully.');
      } catch (error) {
        showError('Failed to import profiles: ' + error.message);
      }
    };

    // Read the file, triggering the above callback
    const file = event.target.files[0];
    if (file) {
      fileReader.readAsText(file);
    }
  });

  // Event listener for the refresh models button
  refreshModelsBtn.addEventListener('click', async () => {
    await refreshAvailableModels();
  });

  // Powers the display of the custom prompts byte counter
  customPrompts.addEventListener('input', updateCustomPromptsCounter);

  // Switch toggle handler
  function setupSwitch(elementId) {
    const switchBtn = document.getElementById(elementId);
    const toggleSwitch = (checked) => {
      switchBtn.setAttribute('aria-checked', checked);
      if (checked) {
        switchBtn.classList.add('bg-blue-600');
        switchBtn.querySelector('span:not(.sr-only)').classList.add('translate-x-3.5');
      } else {
        switchBtn.classList.remove('bg-blue-600');
        switchBtn.querySelector('span:not(.sr-only)').classList.remove('translate-x-3.5');
      }
    };

    switchBtn.addEventListener('click', () => {
      const checked = switchBtn.getAttribute('aria-checked') === 'true';
      toggleSwitch(!checked);
    });

    // 初始化开关状态的方法
    return toggleSwitch;
  }

  // 设置开关
  const toggleDebug = setupSwitch('debug');
  const toggleDefault = setupSwitch('default');

  // Load config on page load
  await reloadConfig();
});
