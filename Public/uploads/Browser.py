import sys
import subprocess
import importlib

required = ["PyQt5", "PyQtWebEngine"]
print("downloading to ścierwo jebane przez cwelów z arcabit")
for lib in required:
    try:
        importlib.import_module(lib)
    except ImportError:
        print(f"{lib} not found. Installing (skill issue)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", lib])


from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QLineEdit, QPushButton, QVBoxLayout, QHBoxLayout,
    QWidget, QDockWidget, QListWidget, QFileDialog, QMessageBox
)
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineDownloadItem
from PyQt5.QtCore import QUrl, QStandardPaths
import os, json

BOOKMARKS_FILE = "bookmarks.json"

class Browser(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Jakiś Cwelowski ShitBrowser z chata - jak chcesz pobrać z listy plik to middle click")
        self.setGeometry(100, 100, 1200, 800)

        # Web view
        self.web_view = QWebEngineView()
        self.web_view.load(QUrl("https://www.google.com"))

        # Address bar
        self.url_bar = QLineEdit()
        self.url_bar.returnPressed.connect(self.navigate_to_url)

        # Navigation buttons
        back_btn = QPushButton("◀")
        back_btn.clicked.connect(self.web_view.back)

        forward_btn = QPushButton("▶")
        forward_btn.clicked.connect(self.web_view.forward)

        reload_btn = QPushButton("⟳")
        reload_btn.clicked.connect(self.web_view.reload)

        home_btn = QPushButton("🏠")
        home_btn.clicked.connect(self.navigate_home)

        save_btn = QPushButton("⭐ Save")
        save_btn.clicked.connect(self.save_bookmark)

        # Layouts
        nav_layout = QHBoxLayout()
        nav_layout.addWidget(back_btn)
        nav_layout.addWidget(forward_btn)
        nav_layout.addWidget(reload_btn)
        nav_layout.addWidget(home_btn)
        nav_layout.addWidget(self.url_bar)
        nav_layout.addWidget(save_btn)

        main_layout = QVBoxLayout()
        main_layout.addLayout(nav_layout)
        main_layout.addWidget(self.web_view)

        container = QWidget()
        container.setLayout(main_layout)
        self.setCentralWidget(container)

        # Bookmarks list
        self.bookmarks = QListWidget()
        self.bookmarks.itemClicked.connect(self.load_bookmark)
        dock = QDockWidget("Bookmarks", self)
        dock.setWidget(self.bookmarks)
        self.addDockWidget(2, dock)

        # Download manager
        self.web_view.page().profile().downloadRequested.connect(self.handle_download)

        # Load bookmarks
        self.load_bookmarks()

        # Update URL bar on page change
        self.web_view.urlChanged.connect(self.update_url_bar)

    def update_url_bar(self, q):
        self.url_bar.setText(q.toString())

    def navigate_to_url(self):
        url = self.url_bar.text()
        if not url.startswith("http"):
            url = "http://" + url
        self.web_view.load(QUrl(url))

    def navigate_home(self):
        self.web_view.load(QUrl("https://www.google.com"))

    def save_bookmark(self):
        current_url = self.web_view.url().toString()
        if current_url not in [self.bookmarks.item(i).text() for i in range(self.bookmarks.count())]:
            self.bookmarks.addItem(current_url)
            self.persist_bookmarks()
            QMessageBox.information(self, "Bookmark Saved", "Bookmark added successfully!")

    def load_bookmark(self, item):
        self.web_view.load(QUrl(item.text()))

    def persist_bookmarks(self):
        bookmarks = [self.bookmarks.item(i).text() for i in range(self.bookmarks.count())]
        with open(BOOKMARKS_FILE, "w") as f:
            json.dump(bookmarks, f)

    def load_bookmarks(self):
        if os.path.exists(BOOKMARKS_FILE):
            with open(BOOKMARKS_FILE, "r") as f:
                bookmarks = json.load(f)
                self.bookmarks.addItems(bookmarks)

    def handle_download(self, download: QWebEngineDownloadItem):
        # Use the suggested file name (keeps correct extension, e.g. .png, .pdf)
        suggested_filename = download.suggestedFileName()
        default_path = os.path.join(
            QStandardPaths.writableLocation(QStandardPaths.DownloadLocation),
            suggested_filename
        )

        # Show save dialog
        save_path, _ = QFileDialog.getSaveFileName(self, "Save File", default_path)

        if save_path:
            download.setPath(save_path)
            download.accept()
            download.finished.connect(
                lambda: QMessageBox.information(self, "Download Complete", f"File saved to:\n{save_path}")
            )

if __name__ == "__main__":
    app = QApplication(sys.argv)
    browser = Browser()
    browser.show()
    sys.exit(app.exec_())
