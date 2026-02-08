from ai_engine import AIEngine


def main() -> None:
    engine = AIEngine()
    text = engine.generate_post_text(include_shill=True)
    image_path = engine.generate_post_image(text)
    with open('post_text.txt', 'w', encoding='utf-8') as handle:
        handle.write(text or '')
    with open('image_path.txt', 'w', encoding='utf-8') as handle:
        handle.write(image_path or '')
    print('POST_TEXT', text)
    print('IMAGE_PATH', image_path)


if __name__ == '__main__':
    main()
