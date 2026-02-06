import SwiftUI
import shared

@main
struct iOSApp: App {
    
    init() {
        // Initialize Koin DI
        KoinInitializerKt.doInitKoin(appDeclaration: { _ in })
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        ComposeView()
            .ignoresSafeArea(.all)
    }
}

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        // Create Compose UI from shared module
        return MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // No updates needed
    }
}
