import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Md5 } from 'ts-md5';
import * as fs from 'fs';
import * as temp from 'temp';
import * as path from 'path';
import { exec } from 'child_process';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	pdflatexCommand: fs.PathLike,
	pdf2svgCommand: fs.PathLike,
	timeout: number,
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	pdflatexCommand: "pdflatex",
	pdf2svgCommand: "pdf2svg2",
	timeout: 10000,

}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	svgFolder = this.app.vault.configDir + "\\latex-svg-renders";

	async onload() {
		await this.loadSettings();
		if (!(await this.app.vault.adapter.exists(this.svgFolder)).valueOf()) {
			this.app.vault.createFolder(this.svgFolder);
		}
		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor("latex", (s, c) => this.renderLatexToContainer(s, c));
	}

	onunload() {
		if (this.app.vault.adapter.exists(this.svgFolder).valueOf()) {
			this.app.vault.adapter.rmdir(this.svgFolder, true);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


	renderLatexToContainer(source: string, container: HTMLElement) {
		return new Promise<void>((resolve, reject) => {
			this.renderLatexToSVG(source).then((v: string) => {
				container.innerHTML = v;
				resolve();
			}
			).catch(err => { container.innerHTML = err; reject(err); });
		});
	}

	renderLatexToSVG(source: string) {
		return new Promise(async (resolve, reject) => {
			source = "\\documentclass{standalone}\n" + source;
			let md5Hash = Md5.hashStr(source);
			let basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
			let localCwd = path.join(this.svgFolder, md5Hash);
			let cwd = path.join(basePath, localCwd);
			let svgFile = md5Hash + ".svg";
			let svgPath = path.join(this.svgFolder, svgFile);
			let texFile = md5Hash + ".tex";
			let pdfFile = md5Hash + ".pdf";

			if (await this.app.vault.adapter.exists(svgPath)) {
				resolve(svgPath)
			} else {
				await this.app.vault.adapter.mkdir(localCwd);
				await this.app.vault.create(path.join(localCwd, texFile), source);
				exec(
					`"${this.settings.pdflatexCommand}" -interaction=nonstopmode -halt-on-error -shell-escape "${texFile}" && "${this.settings.pdf2svgCommand}" "${path.join(cwd, pdfFile)}" "${cwd}"`,
					{ timeout: this.settings.timeout, cwd: cwd },
					async (err, stdout, stderr) => {
						if (err) reject([err, stdout, stderr]);
						else {
							// await this.app.vault.adapter.rename(path.join(localCwd, "content1.svg"), svgPath);
							let svgData = await this.app.vault.adapter.read(path.join(localCwd, "content1.svg"));
							await this.app.vault.adapter.rmdir(localCwd, true);
							resolve(svgData);
						};
					},
				);
			}
		});
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

		new Setting(containerEl)
			.setName('pdflatex Command')
			.addText(text => text
				.setValue(this.plugin.settings.pdflatexCommand.toString())
				.onChange(async (value) => {
					this.plugin.settings.pdflatexCommand = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('pdf2svg Command')
			.addText(text => text
				.setValue(this.plugin.settings.pdf2svgCommand.toString())
				.onChange(async (value) => {
					this.plugin.settings.pdf2svgCommand = value;
					await this.plugin.saveSettings();
				}));
	}
}