import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';

void main() {
  runApp(const DocuChatApp());
}

class DocuChatApp extends StatelessWidget {
  const DocuChatApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'DocuChat',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        scaffoldBackgroundColor: const Color(0xFFF7F8FC),
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  // ==================================================
  // PDF
  // ==================================================

  Uint8List? pdfBytes;
  String? fileName;

  // Backend document ID
  String? openAIFileId;

  // ==================================================
  // UI STATE
  // ==================================================

  bool uploading = false;
  bool summarizing = false;
  bool loadingKeyPoints = false;
  bool chatting = false;

  // 0 = PDF
  // 1 = Summary
  // 2 = Key Points
  // 3 = Chat
  int selectedView = 0;

  String status = '';
  String? summary;
  String? keyPoints;

  final List<Map<String, String>> chatMessages = [];

  final TextEditingController chatController = TextEditingController();

  // ==================================================
  // BACKEND
  // ==================================================
  String serverUrl = '';
  bool isServerOnline = false;
  Timer? serverStatusTimer;
  Future<void> loadServerUrl() async {
    final response = await http.get(
      Uri.parse(
        'https://raw.githubusercontent.com/aslamcsengineer/Docuchat/main/config.json',
      ),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);

      setState(() {
        serverUrl = data['backendUrl'];
      });

      debugPrint('Backend URL loaded: $serverUrl');
    } else {
      throw Exception('Failed to load backend URL');
    }
  }

  Future<void> checkServerStatus() async {
    if (serverUrl.isEmpty) return;

    try {
      final response = await http
          .get(Uri.parse('$serverUrl/health'))
          .timeout(const Duration(seconds: 5));

      if (!mounted) return;

      setState(() {
        isServerOnline = response.statusCode == 200;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isServerOnline = false;
      });
    }
  }

  @override
  void initState() {
    super.initState();

    loadServerUrl().then((_) {
      checkServerStatus();

      serverStatusTimer = Timer.periodic(
        const Duration(seconds: 10),
        (_) => checkServerStatus(),
      );
    });
  }

  @override
  void dispose() {
    serverStatusTimer?.cancel();
    chatController.dispose();
    super.dispose();
  }

  // ==================================================
  // PICK PDF
  // ==================================================

  Future<void> pickPDF() async {
    try {
      print('1. Upload button clicked');

      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
        withData: true,
      );

      if (result == null) {
        print('No PDF selected');
        return;
      }

      final file = result.files.single;

      print('2. Selected PDF: ${file.name}');

      if (file.bytes == null) {
        showMessage('Could not read PDF.');
        return;
      }

      setState(() {
        pdfBytes = file.bytes;
        fileName = file.name;

        openAIFileId = null;

        summary = null;
        keyPoints = null;

        chatMessages.clear();
        chatController.clear();

        selectedView = 0;

        uploading = false;
        summarizing = false;
        loadingKeyPoints = false;
        chatting = false;

        status = 'PDF selected';
      });

      print('3. PDF loaded into Flutter');

      await uploadPDFToBackend();
    } catch (e) {
      print('PICK PDF ERROR: $e');
      showMessage('PDF error: $e');
    }
  }

  // ==================================================
  // UPLOAD PDF TO BACKEND
  // ==================================================

  Future<void> uploadPDFToBackend() async {
    if (pdfBytes == null || fileName == null) {
      return;
    }

    print('4. Starting backend upload...');

    setState(() {
      uploading = true;
      status = 'Preparing document for AI...';
    });

    try {
      final uri = Uri.parse('$serverUrl/upload');

      print('5. Sending PDF to: $uri');

      final request = http.MultipartRequest('POST', uri);

      request.files.add(
        http.MultipartFile.fromBytes('pdf', pdfBytes!, filename: fileName!),
      );

      print('6. Sending request...');

      final streamedResponse = await request.send();

      print(
        '7. Server status: '
        '${streamedResponse.statusCode}',
      );

      final response = await http.Response.fromStream(streamedResponse);

      print(
        '8. Server response: '
        '${response.body}',
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Server error '
          '${response.statusCode}: '
          '${response.body}',
        );
      }

      final data = jsonDecode(response.body);

      final returnedFileId = data['fileId'];

      if (returnedFileId == null) {
        throw Exception('Backend did not return fileId.');
      }

      setState(() {
        openAIFileId = returnedFileId.toString();

        status = 'AI Ready ✓';
      });

      print(
        '9. SUCCESS! Document ID: '
        '$openAIFileId',
      );

      showMessage('PDF is ready for AI!');
    } catch (e) {
      print('UPLOAD ERROR: $e');

      setState(() {
        status = 'Upload failed';
      });

      showMessage('Upload failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          uploading = false;
        });
      }
    }
  }

  // ==================================================
  // SUMMARY
  // ==================================================

  Future<void> summarizePDF() async {
    if (openAIFileId == null) {
      showMessage('Wait until AI Ready ✓');
      return;
    }

    if (summarizing) {
      return;
    }

    print('10. Starting summary...');

    setState(() {
      summarizing = true;
    });

    try {
      final response = await http.post(
        Uri.parse('$serverUrl/summary'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'fileId': openAIFileId}),
      );

      print(
        '11. Summary status: '
        '${response.statusCode}',
      );

      print(
        '12. Summary response: '
        '${response.body}',
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Server error '
          '${response.statusCode}: '
          '${response.body}',
        );
      }

      final data = jsonDecode(response.body);

      final generatedSummary = data['summary'];

      if (generatedSummary == null) {
        throw Exception('No summary returned.');
      }

      setState(() {
        summary = generatedSummary.toString();
      });

      print('13. Summary generated successfully');
    } catch (e) {
      print('SUMMARY ERROR: $e');

      showMessage('Summary failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          summarizing = false;
        });
      }
    }
  }

  // ==================================================
  // KEY POINTS
  // ==================================================

  Future<void> generateKeyPoints() async {
    if (openAIFileId == null) {
      showMessage('Wait until AI Ready ✓');
      return;
    }

    if (loadingKeyPoints) {
      return;
    }

    setState(() {
      loadingKeyPoints = true;
    });

    try {
      print('Generating key points...');

      final response = await http.post(
        Uri.parse('$serverUrl/important'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'fileId': openAIFileId}),
      );

      print(
        'Key Points status: '
        '${response.statusCode}',
      );

      print(
        'Key Points response: '
        '${response.body}',
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Server error '
          '${response.statusCode}: '
          '${response.body}',
        );
      }

      final data = jsonDecode(response.body);

      // Backend /important returns:
      // { success: true, answer: ... }
      final result = data['answer'];

      if (result == null) {
        throw Exception('No key points returned.');
      }

      setState(() {
        keyPoints = result.toString();
      });
    } catch (e) {
      print('KEY POINTS ERROR: $e');

      showMessage('Key Points failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          loadingKeyPoints = false;
        });
      }
    }
  }

  // ==================================================
  // CHAT
  // ==================================================

  Future<void> askQuestion() async {
    final question = chatController.text.trim();

    if (openAIFileId == null) {
      showMessage('Wait until AI Ready ✓');
      return;
    }

    if (question.isEmpty) {
      showMessage('Please enter a question.');
      return;
    }

    if (chatting) {
      return;
    }

    setState(() {
      chatting = true;

      chatMessages.add({'role': 'user', 'text': question});
    });

    chatController.clear();

    try {
      print('Sending question: $question');

      final response = await http.post(
        Uri.parse('$serverUrl/chat'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'fileId': openAIFileId, 'question': question}),
      );

      print(
        'Chat status: '
        '${response.statusCode}',
      );

      print(
        'Chat response: '
        '${response.body}',
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Server error '
          '${response.statusCode}: '
          '${response.body}',
        );
      }

      final data = jsonDecode(response.body);

      final answer = data['answer'];

      if (answer == null) {
        throw Exception('No answer returned.');
      }

      setState(() {
        chatMessages.add({'role': 'assistant', 'text': answer.toString()});
      });
    } catch (e) {
      print('CHAT ERROR: $e');

      showMessage('Chat failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          chatting = false;
        });
      }
    }
  }

  // ==================================================
  // CLOSE PDF
  // ==================================================

  void closePDF() {
    setState(() {
      pdfBytes = null;
      fileName = null;
      openAIFileId = null;

      summary = null;
      keyPoints = null;

      chatMessages.clear();
      chatController.clear();

      selectedView = 0;

      status = '';

      uploading = false;
      summarizing = false;
      loadingKeyPoints = false;
      chatting = false;
    });
  }

  // ==================================================
  // MESSAGE
  // ==================================================

  void showMessage(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  // ==================================================
  // MAIN UI
  // ==================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        elevation: 0,
        titleSpacing: 20,
        title: const Row(
          children: [
            Icon(Icons.auto_awesome, color: Colors.indigo),
            SizedBox(width: 10),
            Text('DocuChat', style: TextStyle(fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: isServerOnline ? Colors.green : Colors.red,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  isServerOnline ? 'Server Online' : 'Server Offline',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),

          if (pdfBytes != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: IconButton(
                onPressed:
                    uploading || summarizing || loadingKeyPoints || chatting
                    ? null
                    : pickPDF,
                icon: const Icon(Icons.upload_file),
                tooltip: 'Upload another PDF',
              ),
            ),
        ],
      ),
      body: pdfBytes == null ? buildHome() : buildDocumentScreen(),
    );
  }

  // ==================================================
  // HOME
  // ==================================================

  Widget buildHome() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 650),
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 50),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.black12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  color: Colors.indigo.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(
                  Icons.picture_as_pdf_outlined,
                  size: 52,
                  color: Colors.indigo,
                ),
              ),

              const SizedBox(height: 28),

              const Text(
                'Your PDF, but smarter.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold),
              ),

              const SizedBox(height: 12),

              const Text(
                'Upload a PDF and use local AI to summarize, '
                'extract key points, and ask questions about the document.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16,
                  height: 1.5,
                  color: Colors.black54,
                ),
              ),

              const SizedBox(height: 30),

              FilledButton.icon(
                onPressed: pickPDF,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 26,
                    vertical: 18,
                  ),
                ),
                icon: const Icon(Icons.upload_file),
                label: const Text('Upload PDF', style: TextStyle(fontSize: 16)),
              ),

              const SizedBox(height: 18),

              const Wrap(
                alignment: WrapAlignment.center,
                spacing: 18,
                runSpacing: 10,
                children: [
                  _FeatureLabel(icon: Icons.auto_awesome, text: 'Summary'),
                  _FeatureLabel(icon: Icons.key, text: 'Key Points'),
                  _FeatureLabel(icon: Icons.chat_outlined, text: 'RAG Chat'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ==================================================
  // DOCUMENT SCREEN
  // ==================================================

  Widget buildDocumentScreen() {
    return Column(
      children: [
        // ------------------------------------------
        // DOCUMENT HEADER
        // ------------------------------------------
        Container(
          width: double.infinity,
          margin: const EdgeInsets.fromLTRB(14, 10, 14, 8),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.black12),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.picture_as_pdf,
                  color: Colors.red,
                  size: 27,
                ),
              ),

              const SizedBox(width: 12),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      fileName ?? 'PDF',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 5),

                    buildStatus(),
                  ],
                ),
              ),

              IconButton(
                onPressed:
                    uploading || summarizing || loadingKeyPoints || chatting
                    ? null
                    : closePDF,
                icon: const Icon(Icons.close),
                tooltip: 'Close PDF',
              ),
            ],
          ),
        ),

        if (uploading) const LinearProgressIndicator(),

        // ------------------------------------------
        // NAVIGATION
        // ------------------------------------------
        if (openAIFileId != null)
          Container(
            margin: const EdgeInsets.fromLTRB(14, 4, 14, 10),
            padding: const EdgeInsets.all(5),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.black12),
            ),
            child: Row(
              children: [
                Expanded(
                  child: buildNavButton(
                    index: 0,
                    icon: Icons.picture_as_pdf,
                    label: 'PDF',
                    onPressed: () {
                      setState(() {
                        selectedView = 0;
                      });
                    },
                  ),
                ),

                const SizedBox(width: 5),

                Expanded(
                  child: buildNavButton(
                    index: 1,
                    icon: Icons.auto_awesome,
                    label: 'Summary',
                    onPressed: () {
                      setState(() {
                        selectedView = 1;
                      });

                      if (summary == null && !summarizing) {
                        summarizePDF();
                      }
                    },
                  ),
                ),

                const SizedBox(width: 5),

                Expanded(
                  child: buildNavButton(
                    index: 2,
                    icon: Icons.key,
                    label: 'Key Points',
                    onPressed: () {
                      setState(() {
                        selectedView = 2;
                      });

                      if (keyPoints == null && !loadingKeyPoints) {
                        generateKeyPoints();
                      }
                    },
                  ),
                ),

                const SizedBox(width: 5),

                Expanded(
                  child: buildNavButton(
                    index: 3,
                    icon: Icons.chat_bubble_outline,
                    label: 'Chat',
                    onPressed: () {
                      setState(() {
                        selectedView = 3;
                      });
                    },
                  ),
                ),
              ],
            ),
          ),

        // ------------------------------------------
        // WAITING FOR AI
        // ------------------------------------------
        if (openAIFileId == null)
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(child: SfPdfViewer.memory(pdfBytes!)),

                if (uploading)
                  Positioned.fill(
                    child: Container(
                      color: Colors.white.withValues(alpha: 0.82),
                      child: const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(),
                            SizedBox(height: 18),
                            Text(
                              'Preparing PDF for AI...',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            SizedBox(height: 6),
                            Text(
                              'Creating document index and embeddings',
                              style: TextStyle(color: Colors.black54),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          )
        // ------------------------------------------
        // CONTENT
        // ------------------------------------------
        else
          Expanded(child: buildSelectedView()),
      ],
    );
  }

  // ==================================================
  // NAV BUTTON
  // ==================================================

  Widget buildNavButton({
    required int index,
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    final selected = selectedView == index;

    if (selected) {
      return FilledButton.icon(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 14),
        ),
        icon: Icon(icon, size: 19),
        label: Text(label),
      );
    }

    return TextButton.icon(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 14),
      ),
      icon: Icon(icon, size: 19),
      label: Text(label),
    );
  }

  // ==================================================
  // SELECTED VIEW
  // ==================================================

  Widget buildSelectedView() {
    switch (selectedView) {
      case 0:
        return Container(
          margin: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.black12),
          ),
          child: SfPdfViewer.memory(pdfBytes!),
        );

      case 1:
        if (summarizing) {
          return buildLoadingView(
            icon: Icons.auto_awesome,
            title: 'AI is reading your PDF...',
            subtitle: 'Generating a concise summary',
          );
        }

        if (summary != null) {
          return buildSummaryView();
        }

        return buildEmptyView(
          icon: Icons.auto_awesome,
          title: 'No summary yet',
          subtitle: 'Open this tab to generate a summary.',
        );

      case 2:
        if (loadingKeyPoints) {
          return buildLoadingView(
            icon: Icons.key,
            title: 'Generating key points...',
            subtitle: 'Finding the most important information',
          );
        }

        if (keyPoints != null) {
          return buildKeyPointsView();
        }

        return buildEmptyView(
          icon: Icons.key,
          title: 'No key points yet',
          subtitle: 'Open this tab to extract important points.',
        );

      case 3:
        return buildChatView();

      default:
        return const SizedBox();
    }
  }

  // ==================================================
  // STATUS
  // ==================================================

  Widget buildStatus() {
    if (uploading) {
      return const Row(
        children: [
          SizedBox(
            width: 15,
            height: 15,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 8),
          Text('Preparing AI...', style: TextStyle(fontSize: 13)),
        ],
      );
    }

    if (openAIFileId != null) {
      return const Row(
        children: [
          Icon(Icons.check_circle, color: Colors.green, size: 18),
          SizedBox(width: 6),
          Text(
            'AI Ready ✓',
            style: TextStyle(
              color: Colors.green,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    return Text(status, style: const TextStyle(fontSize: 13));
  }

  // ==================================================
  // SUMMARY VIEW
  // ==================================================

  Widget buildSummaryView() {
    return buildContentCard(
      icon: Icons.auto_awesome,
      title: 'AI Summary',
      subtitle: 'A concise overview of your document',
      child: SelectableText(
        summary ?? 'No summary available.',
        style: const TextStyle(fontSize: 16, height: 1.7),
      ),
    );
  }

  // ==================================================
  // KEY POINTS VIEW
  // ==================================================

  Widget buildKeyPointsView() {
    return buildContentCard(
      icon: Icons.key,
      title: 'Key Points',
      subtitle: 'Important information extracted from the PDF',
      child: SelectableText(
        keyPoints ?? 'No key points available.',
        style: const TextStyle(fontSize: 16, height: 1.7),
      ),
    );
  }

  // ==================================================
  // CONTENT CARD
  // ==================================================

  Widget buildContentCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget child,
  }) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 14),
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.indigo.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: Colors.indigo),
              ),

              const SizedBox(width: 12),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),

              OutlinedButton.icon(
                onPressed: () {
                  setState(() {
                    selectedView = 0;
                  });
                },
                icon: const Icon(Icons.picture_as_pdf, size: 18),
                label: const Text('PDF'),
              ),
            ],
          ),

          const SizedBox(height: 16),

          const Divider(),

          const SizedBox(height: 12),

          Expanded(child: SingleChildScrollView(child: child)),
        ],
      ),
    );
  }

  // ==================================================
  // CHAT VIEW
  // ==================================================

  Widget buildChatView() {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black12),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
            child: Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: Colors.indigo.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.chat_bubble_outline,
                    color: Colors.indigo,
                  ),
                ),

                const SizedBox(width: 12),

                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Chat with PDF',
                        style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Answers are retrieved from your document',
                        style: TextStyle(fontSize: 13, color: Colors.black54),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const Divider(height: 1),

          Expanded(
            child: chatMessages.isEmpty
                ? buildEmptyChat()
                : ListView.builder(
                    padding: const EdgeInsets.all(20),
                    itemCount: chatMessages.length,
                    itemBuilder: (context, index) {
                      final message = chatMessages[index];

                      final isUser = message['role'] == 'user';

                      return Align(
                        alignment: isUser
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          constraints: const BoxConstraints(maxWidth: 720),
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(15),
                          decoration: BoxDecoration(
                            color: isUser
                                ? Colors.indigo.withValues(alpha: 0.10)
                                : const Color(0xFFF3F4F8),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: isUser
                                  ? Colors.indigo.withValues(alpha: 0.15)
                                  : Colors.black12,
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isUser ? 'You' : 'DocuChat',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: isUser
                                      ? Colors.indigo
                                      : Colors.black54,
                                ),
                              ),
                              const SizedBox(height: 5),
                              SelectableText(
                                message['text'] ?? '',
                                style: const TextStyle(
                                  fontSize: 15,
                                  height: 1.55,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),

          if (chatting)
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 4, 18, 8),
              child: Row(
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 10),
                  Text(
                    'DocuChat is thinking...',
                    style: TextStyle(color: Colors.black54),
                  ),
                ],
              ),
            ),

          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Colors.black12)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: chatController,
                    enabled: !chatting,
                    onSubmitted: (_) {
                      if (!chatting) {
                        askQuestion();
                      }
                    },
                    decoration: InputDecoration(
                      hintText: 'Ask anything about this PDF...',
                      prefixIcon: const Icon(Icons.chat_bubble_outline),
                      filled: true,
                      fillColor: const Color(0xFFF7F8FC),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 10),

                FilledButton.icon(
                  onPressed: chatting ? null : askQuestion,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 18,
                    ),
                  ),
                  icon: chatting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send),
                  label: Text(chatting ? 'Thinking...' : 'Send'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ==================================================
  // EMPTY CHAT
  // ==================================================

  Widget buildEmptyChat() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.question_answer_outlined,
              size: 56,
              color: Colors.indigo,
            ),
            SizedBox(height: 16),
            Text(
              'Ask your PDF anything',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 7),
            Text(
              'DocuChat will retrieve relevant sections '
              'from the document and answer your question.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }

  // ==================================================
  // LOADING VIEW
  // ==================================================

  Widget buildLoadingView({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Center(
      child: Container(
        padding: const EdgeInsets.all(30),
        margin: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Colors.indigo.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Icon(icon, color: Colors.indigo, size: 30),
            ),

            const SizedBox(height: 20),

            const CircularProgressIndicator(),

            const SizedBox(height: 18),

            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),

            const SizedBox(height: 6),

            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  // ==================================================
  // EMPTY VIEW
  // ==================================================

  Widget buildEmptyView({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 50, color: Colors.indigo),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.black54),
          ),
        ],
      ),
    );
  }
}

// ==================================================
// SMALL HOME FEATURE LABEL
// ==================================================

class _FeatureLabel extends StatelessWidget {
  final IconData icon;
  final String text;

  const _FeatureLabel({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 17, color: Colors.indigo),
        const SizedBox(width: 5),
        Text(text, style: const TextStyle(fontWeight: FontWeight.w500)),
      ],
    );
  }
}
