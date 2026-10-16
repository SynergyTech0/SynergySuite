/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;

// Synergy Diagrams: the AI window (Generate) answered by the suite's own model. Upstream only adds
// it when the editor may reach outside servers, and stealth mode (no calls to anyone's servers but
// this app's) counts as offline. The suite's model is reached through this app (/api/ai/chat), so
// the window comes back whenever the suite page turns AI on in its configure message.
(function()
{
	var menusInit = Menus.prototype.init;

	Menus.prototype.init = function()
	{
		menusInit.apply(this, arguments);
		var ui = this.editorUi;

		if (Editor.enableAi && ui.actions.get('generate') == null &&
			typeof ui.openGenerateDialog === 'function')
		{
			var action = ui.actions.put('generate', new Action('generate', function()
			{
				if (ui.chatWindow != null)
				{
					ui.chatWindow.window.setVisible(!ui.chatWindow.window.isVisible());
				}
				else
				{
					ui.openGenerateDialog('');
				}
			}));

			action.isEnabled = function()
			{
				return ui.editor.graph.isEnabled();
			};

			action.setToggleAction(true);

			action.setSelectedCallback(function()
			{
				return ui.chatWindow != null && ui.chatWindow.window.isVisible();
			});
		}
	};
})();

// Synergy Diagrams: the AI window opens on "Create Diagram" (upstream's first choice there is its
// own hosted generator, which stealth mode leaves out, so it would open on a clipboard action).
(function()
{
	var openGenerateDialog = App.prototype.openGenerateDialog;

	App.prototype.openGenerateDialog = function()
	{
		var first = this.chatWindow == null;
		var result = openGenerateDialog.apply(this, arguments);

		if (first && this.chatWindow != null && this.chatWindow.window != null)
		{
			var selects = this.chatWindow.window.div.getElementsByTagName('select');

			for (var i = 0; i < selects.length; i++)
			{
				if (selects[i].querySelector('option[value="create"]') != null)
				{
					selects[i].value = 'create';
					selects[i].dispatchEvent(new Event('change'));
				}
			}
		}

		return result;
	};
})();
