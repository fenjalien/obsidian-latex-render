import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Md5 } from 'ts-md5';
import * as fs from 'fs';
import * as temp from 'temp';
import * as path from 'path';
import { exec } from 'child_process';

interface MyPluginSettings {
	command: string
	timeout: number,
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	// `"${this.settings.pdflatexCommand}" -interaction=nonstopmode -halt-on-error -shell-escape "${texFile}" && "${this.settings.pdf2svgCommand}" "${path.join(cwd, pdfFile)}" "${cwd}"`
	// 
	command: `pdflatex -interaction=nonstopmode -halt-on-error -shell-escape "{tex-file}" && pdf2svg "{pdf-file}" "{output-dir}"`,
	timeout: 10000,

}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor("latex", (s, c) => this.renderLatexToContainer(s, c));
	}

	onunload() {
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
			let svgFile = md5Hash + ".svg";
			let texFile = md5Hash + ".tex";
			let pdfFile = md5Hash + ".pdf";

			temp.mkdir("obsidian-latex-renderer", (err, dirPath) => {
				if (err) reject(err);
				fs.writeFileSync(path.join(dirPath, texFile), source);
				exec(
					this.settings.command.replace("{tex-file}", texFile).replace("{pdf-file}", path.join(dirPath, pdfFile)).replace("{output-dir}", dirPath)
					,
					{ timeout: this.settings.timeout, cwd: dirPath },
					async (err, stdout, stderr) => {
						if (err) reject([err, stdout, stderr]);
						else {
							let svgData = fs.readFileSync(path.join(dirPath, "content1.svg"));
							resolve(svgData);
						};
					},
				);
			})
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
			.setName('Command to generate SVG')
			.addText(text => text
				.setValue(this.plugin.settings.command.toString())
				.onChange(async (value) => {
					this.plugin.settings.command = value;
					await this.plugin.saveSettings();
				}));
	}
}

