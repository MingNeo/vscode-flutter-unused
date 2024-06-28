import path from 'path'
import * as fs from 'fs'
import * as jsyaml from 'js-yaml'
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log('"flutter-unused" is now active!')

  const terminal = vscode.window.createTerminal('flutter-unused')

  const findUnusedListDisposable = vscode.commands.registerCommand('flutter-unused.findUnusedList', () => {
    // loading message
    // vscode.window.showInformationMessage('Finding unreferenced resources...')
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0]?.uri.fsPath
        : undefined
    if (!rootPath) {
      vscode.window.showErrorMessage('No workspace is open.')
      return
    }
    const pubspecPath = path.join(rootPath, 'pubspec.yaml')
    if (fs.existsSync(pubspecPath)) {
      const pubspecContent = fs.readFileSync(pubspecPath, 'utf8')
      if (!pubspecContent.includes('flutter:')) {
        vscode.window.showErrorMessage('This is not a Flutter project.')
        return
      }
    } else {
      vscode.window.showErrorMessage('pubspec.yaml not found. This is not a Flutter project.')
      return
    }
    const libPath = path.join(rootPath, 'lib')

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        cancellable: true,
        title: 'Finding unreferenced resources ...',
      },
      async (progress) => {
        progress.report({ increment: 0 })

        await Promise.all([
          findUnusedAssets().then((data) => displayResults(data, 'assets')),
          findUnusedDependencies(libPath).then((data) => displayResults(data, 'dependencies')),
          findUnusedDartFiles().then((data) => displayResults(data, 'files')),
        ])

        progress.report({ increment: 100 })
      },
    )
  })

  const deleteResourceDisposable = vscode.commands.registerCommand('flutter-unused.deleteResource', (resource: Resource) => {
    vscode.window.showWarningMessage(`Are you sure you want to delete ${resource.name}?`, { modal: true }, 'Delete').then((selection) => {
      if (selection === 'Delete') {
        if (resource.type === 'dependency') {
          // 删除依赖项
          const pubspecPath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'pubspec.yaml')
          try {
            // 读取pubspec.yaml文件内容
            let data = fs.readFileSync(pubspecPath, 'utf8')
            let lines = data.split('\n')
            // 遍历文件的每一行，寻找依赖项
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(resource.name)) {
                lines.splice(i, 1) // 删除依赖项所在的行
                break
              }
            }
            // 将更新后的内容写回文件
            fs.writeFileSync(pubspecPath, lines.join('\n'))

            // 运行flutter pub get
            terminal.sendText('flutter pub get')
            // vscode.window.showInformationMessage('Dependency deleted successfully.')
          } catch (err) {
            console.error(err)
            vscode.window.showErrorMessage('Failed to delete dependency.')
          }
        } else {
          fs.unlinkSync(resource.path)
        }
        // 删除后更新视图
        vscode.commands.executeCommand('flutter-unused.findUnusedList')
      }
    })
  })

  // context.subscriptions.push(openFileDisposable)
  context.subscriptions.push(deleteResourceDisposable)
  context.subscriptions.push(findUnusedListDisposable)
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Find unreferenced assets
async function findUnusedAssets(): Promise<Resource[]> {
  const [assetFiles, dartFiles] = await Promise.all([
    vscode.workspace.findFiles(`assets/**/*`, `assets/fonts/**/*`, 10000),
    vscode.workspace.findFiles(`lib/**/*.dart`, null, 10000),
  ])

  const assetNames = assetFiles.map((asset) => path.basename(asset.fsPath))

  const referencedAssets: Set<string> = new Set()

  for (const dartFile of dartFiles) {
    const dartContent = fs.readFileSync(dartFile.fsPath, 'utf-8')
    assetNames.forEach((asset) => {
      const assetReference = `${asset}`
      if (dartContent.includes(assetReference)) {
        referencedAssets.add(asset)
      }
    })
  }

  const unreferencedAssets: Resource[] = []
  for (const asset of assetFiles) {
    const assetName = path.basename(asset.fsPath)
    if (!referencedAssets.has(assetName)) {
      unreferencedAssets.push(new Resource(assetName, asset.fsPath))
    }
  }

  return unreferencedAssets
}

// Find unreferenced Dart files
async function findUnusedDartFiles(): Promise<Resource[]> {
  const dartFiles = await vscode.workspace.findFiles(`lib/**/*.dart`, null, 10000)
  const referencedDartFiles: Set<string> = new Set()

  for (const dartFile of dartFiles) {
    const dartFileName = path.basename(dartFile.fsPath)

    for (const file of dartFiles) {
      const dartContent = fs.readFileSync(file.fsPath, 'utf-8')
      if (file.fsPath !== dartFile.fsPath && dartContent.includes(dartFileName)) {
        referencedDartFiles.add(dartFileName)
      }
    }
  }

  const unreferencedFiles: Resource[] = []
  for (const file of dartFiles) {
    const fileName = path.basename(file.fsPath)
    if (!referencedDartFiles.has(fileName) && fileName !== 'main.dart') {
      unreferencedFiles.push(new Resource(fileName, file.fsPath))
    }
  }

  return unreferencedFiles
}

// Find unreferenced dependencies
async function findUnusedDependencies(libPath: string): Promise<string[]> {
  const pubspecPath = path.join(libPath, '..', 'pubspec.yaml')
  if (!fs.existsSync(pubspecPath)) {
    return []
  }

  const pubspecContent = fs.readFileSync(pubspecPath, 'utf-8')
  const pubspec = jsyaml.load(pubspecContent) as {
    dependencies: { [key: string]: string }
  }
  const dependencies = pubspec.dependencies
    ? Object.keys(pubspec.dependencies).filter((dep) => dep !== 'flutter' && dep !== 'flutter_test')
    : []

  const dartFiles = await vscode.workspace.findFiles(`lib/**/*.dart`, null, 10000)

  const referencedDependencies: Set<string> = new Set()

  for (const dartFile of dartFiles) {
    const dartContent = fs.readFileSync(dartFile.fsPath, 'utf-8')
    for (const dep of dependencies) {
      const depReference = `${dep}`

      if (dartContent.includes(depReference)) {
        referencedDependencies.add(dep)
      }
    }
  }

  return dependencies.filter((dep) => !referencedDependencies.has(dep))
}

// Display the results in the sidebar
function displayResults(reources: Resource[] | string[], type: 'assets' | 'dependencies' | 'files') {
  const treeDataProvider = new UnusedResourcesTreeDataProvider(reources, type)

  vscode.window.createTreeView(`flutter-unused-${type}`, { treeDataProvider: treeDataProvider })
}

class Resource {
  constructor(public readonly name: string, public readonly path: string, public readonly type?: string) {}
}

class UnusedResourcesTreeDataProvider implements vscode.TreeDataProvider<Resource> {
  constructor(private resources: any[], private type: string) {}

  getTreeItem(element: Resource): vscode.TreeItem {
    // 检测元素类型：这里假设Resource有一个type属性
    if (element.type === 'dependency') {
      // 为依赖项生成特定的命令
      const line = this.findDependencyLine(element.name) // 假设这个方法能找到依赖项在pubspec.yaml中的行号
      return {
        label: element.name,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        command: {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [
            vscode.Uri.file(path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'pubspec.yaml')),
            { selection: new vscode.Range(line, 0, line, 0) },
          ],
        },
      }
    } else {
      // 其他类型元素的处理保持不变
      return {
        label: element.name,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        command: {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [element.path],
        },
        contextValue: 'deletable',
      }
    }
  }

  private findDependencyLine(dependencyName: string): number {
    // 获取pubspec.yaml文件的路径
    const pubspecPath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'pubspec.yaml')

    try {
      // 读取pubspec.yaml文件内容
      const data = fs.readFileSync(pubspecPath, 'utf8')
      const lines = data.split('\n')

      // 遍历文件的每一行，寻找依赖项
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(dependencyName)) {
          return i // 返回依赖项所在的行号
        }
      }
    } catch (err) {
      console.error(err)
      return -1 // 文件读取错误或依赖项未找到
    }

    return -1 // 默认返回值，表示未找到依赖项
  }

  getChildren(): Thenable<Resource[]> {
    const results: Resource[] = []

    if (this.type === 'dependencies') {
      this.resources.forEach((dep) => {
        results.push(new Resource(dep, '', 'dependency'))
      })
    } else {
      results.push(...this.resources)
    }

    return Promise.resolve(results)
  }

  getParent(): vscode.ProviderResult<Resource> {
    return null
  }
}
